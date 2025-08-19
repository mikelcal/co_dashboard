// === Imports ===
import {
  toggleWindOverlay,
  loadWindData,
  useWindData,
  getWindByAbbr,
  windDataCache,
} from "./windVectors.js";
import { showLoader, hideLoader } from "./loaderUtils.js";
const toggleWindOverlayDebounced = debounce(toggleWindOverlay, 1500);

// === Constants & Global State ===

// Loaders
const loaders = {
  map: "mapLoader",
  treemap: "treemapLoader",
  bar: "groupedBarLoader",
};
// colors for treemap regions
const regionColors = {
  Northern: "#1f77b4",
  Southern: "#ff7f0e",
  Other: "#2ca02c",
};

// colors for bar chart legend
const colorMap = {
  windDefault: "steelblue",
  windTop3: "darkblue",
  windBottom3: "lightskyblue",

  coDefault: "lightcoral",
  coTop3: "darkred",
  coBottom3: "lightpink",

  trendLine: "black",
};

// bar chart default size
const CHART_WIDTH = 960;
const CHART_HEIGHT = 720;

// global brush helpers
let fullDataSet;
let brush, brushGroup;

// treemap regions
let selectedRegions = new Set(["Northern", "Southern", "Other"]);

// Default dropdown state
const defaultState = "Georgia";

// Global Wind Rose Variables
let windRoseTimer = null;
let windRoseIsPlaying = false;
let listenersAttached = false;
let windRoseData = {};
let windYears = [];
let windYearIndex = 0;

// Global Choropleth map variables
const WIND_VECTOR_URLS = {
  static: "/wind_vectors/static",
  animated: "/wind_vectors/animated",
  seasonal: "/wind_vectors/seasonal",
  correlation: "/wind_vectors/static",
};

let currentMapMode = "static";
let windOverlayActive = false;
let usTopoJSON = null;
let fipsToCentroid = new Map();
let projection = d3.geoAlbersUsa().scale(1200).translate([480, 300]);
let animatedData = null;
let fipsToAbbr = new Map();
let abbrToFips = new Map();
let fipsToMeta = new Map();
let metaByFIPS = new Map();
let currentYearIndex = 0;
let years = [];
let seasons = [];
let statePaths = null;
let colorScale = null;
let stateLabelGroup = null;

let getValue = (fips, key) => {
  const abbr = fipsToAbbr.get(fips);
  if (!animatedData || !abbr) return null;

  if (currentMode === "year") {
    return animatedData?.[abbr]?.year?.[key] ?? null;
  } else if (currentMode === "season") {
    return animatedData?.[abbr]?.season?.[key] ?? null;
  }

  return null;
};

let updateTooltip = function (fips) {
  const abbr = fipsToAbbr.get(fips);
  const meta = animatedData?.[abbr];
  const tooltip = d3.select("#tooltip");
  const stateMeta = { name: meta.state, abbr, fips };

  let label = "";
  let coVal = null;
  let wind = null;

  if (currentMode === "year") {
    const year = years[currentYearIndex];
    label = `Year: ${year}`;
    coVal = getValue(fips, year);
    wind = getWindByAbbr(abbr, { mode: "animated", year });
  } else if (currentMode === "season") {
    const { year, season } = progressionValues[currentIndex];
    const key = `${year}-${season}`;
    label = `Season: ${season} ${year}`;
    coVal = getValue(fips, key);
    wind = getWindByAbbr(abbr, { mode: "seasonal", year, season });
  }
  // console.log(
  //   `Updating tooltip for ${abbr} (${fips}) in ${currentMode} mode. META: ${JSON.stringify(
  //     meta,
  //     null,
  //     2
  //   )}`
  // );
  const html = getCombinedTooltipHTML(stateMeta, coVal, wind, { label });
  tooltip.html(html);
};

let updateVisuals = function (mode, index) {
  if (mode === "year") {
    updateMap(index);
  } else if (mode === "season") {
    updateMapSeasons(index);
  }
};

let hoveredStateId = null;
let currentMode = "year"; // or "season"
let currentIndex = 0;
let progressionValues = [];
let animationTimer = null;

function updateProgressLabels() {
  document.querySelectorAll(".year-label").forEach((el) => {
    if (currentMode === "season") {
      const { year, season } = progressionValues[currentIndex];
      el.textContent = `Season: ${season} ${year}`;
    } else {
      el.textContent = `Year: ${years[currentIndex]}`;
    }
  });
}

function startYearAnimation() {
  if (animationTimer) return;
  animationTimer = setInterval(() => {
    currentIndex = (currentIndex + 1) % progressionValues.length;
    updateVisuals(currentMode, currentIndex);
    document.getElementById("scrubberSlider-map").value = currentIndex;
    updateProgressLabels();
  }, 2000);
}

function stopYearAnimation() {
  clearInterval(animationTimer);
  animationTimer = null;
}

function toggleAnimatedControlsVisibility(isVisible) {
  const controls = document.getElementById("progressionControls");

  if (isVisible) {
    controls.classList.remove("fade-in"); // reset animation
    void controls.offsetWidth; // trigger reflow
    controls.classList.add("fade-in");
    controls.classList.remove("hidden"); // make visible
  } else {
    controls.classList.add("hidden"); // hide it again
    controls.classList.remove("fade-in"); // optional: reset animation
  }
  const yearTitle = document.getElementById("yearTitle");
  if (yearTitle) {
    if (isVisible) {
      yearTitle.classList.remove("hidden");
      void yearTitle.offsetWidth;
      yearTitle.classList.add("fade-in");
    } else {
      yearTitle.classList.add("hidden");
      yearTitle.classList.remove("fade-in");
    }
  }
}

// === Utility Functions ===
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function renderStateLabels(svg, states) {
  if (stateLabelGroup) stateLabelGroup.remove();

  stateLabelGroup = svg
    .append("g")
    .attr("class", "state-labels")
    .attr("pointer-events", "none");

  const labelableStates = states.filter((d) => {
    const [x, y] = projection(fipsToCentroid.get(d.id)) || [];
    return x != null && y != null && d3.geoArea(d) > 0.0015;
  });

  stateLabelGroup
    .selectAll("text")
    .data(labelableStates)
    .enter()
    .append("text")
    .attr("x", (d) => projection(fipsToCentroid.get(d.id))?.[0] || 0)
    .attr("y", (d) => projection(fipsToCentroid.get(d.id))?.[1] || 0)
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .style("font-size", "12px")
    .style("fill", (d) => (d.id === "15" ? "black" : "white"))
    .style("stroke", "rgba(0,0,0,0.4)")
    .style("stroke-width", "2px")
    .style("paint-order", "stroke")
    .text((d) => fipsToAbbr.get(d.id) || "");

  // Raise to top in case it's behind other elements
  stateLabelGroup.raise();
}

function updateMap(yearIndex) {
  currentYearIndex = yearIndex;

  const updateYearLabel = () => {
    document.querySelectorAll(".year-label").forEach((el) => {
      if (currentMode === "season") {
        const { year, season } = progressionValues[currentIndex];
        el.textContent = `Season: ${season} ${year}`;
      } else {
        const year = years[currentYearIndex];
        el.textContent = `Year: ${year}`;
      }
    });
  };

  updateYearLabel();

  const year =
    currentMode === "season"
      ? progressionValues[yearIndex].year
      : years[yearIndex];

  statePaths
    .transition()
    .duration(750)
    .attr("fill", (d) => {
      const val = getValue(d.id, year);
      return val != null ? colorScale(val) : "#ccc";
    });

  // Sync tooltip
  if (
    hoveredStateId &&
    d3.select("#tooltip").style("visibility") === "visible"
  ) {
    updateTooltip(hoveredStateId);
  }

  // Sync wind overlay
  if (windOverlayActive) {
    const svg = d3.select("#mapVisualizationContainer svg");
    toggleWindOverlayDebounced({
      svg,
      projection,
      fipsToCentroid,
      dataUrl: WIND_VECTOR_URLS[currentMapMode],
      active: true,
      filterYear: year, // sync by year
    });
  }
}

function updateMapYears(yearIndex = 0) {
  if (!animatedData) {
    console.error("animatedData not yet available!");
    return;
  }

  fipsToAbbr = new Map();
  Object.entries(animatedData).forEach(([abbr, entry]) => {
    fipsToAbbr.set(entry.state_fips, abbr);
  });

  const sampleState = Object.values(animatedData)[0];
  //console.log("Sample state data:", sampleState);
  if (!sampleState || !sampleState.year) {
    console.warn("No year data found in animatedData");
    return;
  }

  years = Object.keys(sampleState.year).sort();
  if (!years.length) return;

  currentIndex = yearIndex;
  currentYearIndex = yearIndex;

  initScrubber("year", years);
  updateMap(yearIndex);

  document.getElementById("scrubberSlider-map").value = yearIndex;
  updateProgressLabels();

  const yearTitle = document.getElementById("yearTitle");
  if (yearTitle) {
    yearTitle.classList.remove("hidden");
    yearTitle.classList.add("fade-in");
  }
}

function updateMapSeasons(index = 0) {
  if (!animatedData) return;

  // Extract and sort season keys
  const sample = Object.values(animatedData)[0];
  if (!sample || !sample.season) return;

  const seasonKeys = Object.keys(sample.season).sort(); // ["2014-Fall", "2014-Spring", ...]
  progressionValues = seasonKeys.map((k) => {
    const [year, season] = k.split("-");
    return { year, season, key: k };
  });

  currentMode = "season";
  currentIndex = index;
  currentYearIndex = index;

  const scrubber = document.getElementById("scrubberSlider-map");
  scrubber.min = 0;
  scrubber.max = progressionValues.length - 1;
  scrubber.value = index;

  const { year, season, key } = progressionValues[index];

  updateProgressLabels();

  // Map color fill update
  statePaths
    .transition()
    .duration(750)
    .attr("fill", (d) => {
      const abbr = fipsToAbbr.get(d.id);
      const value = animatedData?.[abbr]?.season?.[key];
      return value != null ? colorScale(value) : "#ccc";
    });

  // Tooltip update
  if (
    hoveredStateId &&
    d3.select("#tooltip").style("visibility") === "visible"
  ) {
    const abbr = fipsToAbbr.get(hoveredStateId);
    //console.log(`Updating tooltip for ${abbr} in season mode`);
    const state = animatedData?.[abbr]?.state ?? "Unknown";
    const value = animatedData?.[abbr]?.season?.[key];

    d3.select("#tooltip").html(`
        <strong>${state} (${abbr})</strong><br>
        Season: ${season} ${year}<br>
        Avg CO: ${value != null ? value.toFixed(3) + " ppm" : "No data"}
      `);
  }

  // Sync wind
  if (windOverlayActive) {
    const svg = d3.select("#mapVisualizationContainer svg");
    toggleWindOverlayDebounced({
      svg,
      projection,
      fipsToCentroid,
      dataUrl: WIND_VECTOR_URLS[currentMapMode],
      active: true,
      filterYear: year, // Year still works for filtering wind
    });
  }
}

function initScrubber(mode, valuesArray) {
  currentMode = mode;
  progressionValues = valuesArray;
  currentIndex = 0;

  const slider = document.getElementById("scrubberSlider-map");
  slider.min = 0;
  slider.max = valuesArray.length - 1;
  slider.value = 0;

  document.querySelectorAll(".year-label").forEach((el) => {
    if (mode === "season") {
      const { season, year } = valuesArray[0];
      el.textContent = `Season: ${season} ${year}`;
    } else {
      el.textContent = `Year: ${valuesArray[0]}`;
    }
  });
}

// Function to handle map scrubber change
document.getElementById("scrubberSlider-map").addEventListener("input", (e) => {
  updateVisuals(currentMode, +e.target.value);
});

document.getElementById("playButton-map").addEventListener("click", () => {
  startYearAnimation();
});

document.getElementById("pauseButton-map").addEventListener("click", () => {
  stopYearAnimation();
});

document
  .getElementById("animationModeToggle")
  .addEventListener("change", (e) => {
    const selectedMode = e.target.value;

    if (selectedMode === "year") {
      updateMapYears();
    } else if (selectedMode === "season") {
      updateMapSeasons();
    }
  });

getValue = (fips, key) => {
  const abbr = fipsToAbbr.get(fips);
  if (!animatedData || !abbr) return null;

  if (currentMode === "year") {
    return animatedData?.[abbr]?.year?.[key] ?? null;
  } else if (currentMode === "season") {
    return animatedData?.[abbr]?.season?.[key] ?? null;
  }

  return null;
};

// Function to calculate correlation coefficient
function getCorrelation(x, y) {
  if (x.length !== y.length) {
    console.warn("Mismatched array lengths in getCorrelation");
    return null;
  }

  const n = x.length;
  const meanX = d3.mean(x);
  const meanY = d3.mean(y);

  const numerator = d3.sum(x.map((xi, i) => (xi - meanX) * (y[i] - meanY)));
  const denominator = Math.sqrt(
    d3.sum(x.map((xi) => (xi - meanX) ** 2)) *
      d3.sum(y.map((yi) => (yi - meanY) ** 2))
  );

  return denominator === 0 ? 0 : numerator / denominator;
}

function computeTrend(data, yAccessor) {
  const baseDate = d3.min(data, (d) => d.date);
  const monthsSince = (date) =>
    (date.getFullYear() - baseDate.getFullYear()) * 12 +
    (date.getMonth() - baseDate.getMonth());

  const clean = data
    .filter((d) => d[yAccessor] != null)
    .map((d) => ({
      x: monthsSince(d.date),
      y: d[yAccessor],
    }));

  const n = clean.length;
  const sumX = d3.sum(clean, (d) => d.x);
  const sumY = d3.sum(clean, (d) => d.y);
  const sumXY = d3.sum(clean, (d) => d.x * d.y);
  const sumX2 = d3.sum(clean, (d) => d.x * d.x);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

function loadUSMapData(mode) {
  return fetch("/static/data/states-10m.json")
    .then((res) => {
      if (!res.ok) throw new Error("Local fetch failed");
      return res.json();
    })
    .catch(() => {
      console.warn("Falling back to CDN for US map TopoJSON");
      return d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
    })
    .then((us) => {
      usTopoJSON = us;
      const states = topojson.feature(us, us.objects.states).features;

      states.forEach((feature) => {
        const fips = feature.id.padStart(2, "0");
        const [lon, lat] = d3.geoCentroid(feature);
        fipsToCentroid.set(fips, [lon, lat]);
      });

      document
        .getElementById("toggleWindVectors")
        .addEventListener("change", (e) => {
          windOverlayActive = e.target.checked;

          const svg = d3.select("#mapVisualizationContainer svg");
          toggleWindOverlay({
            svg,
            projection,
            fipsToCentroid,
            dataUrl: WIND_VECTOR_URLS[mode],
            active: windOverlayActive,
          });
        });

      return us; // Return the loaded TopoJSON
    });
}
// === Page Initialization ===

document.addEventListener("DOMContentLoaded", () => {
  // Fetch state data for dropdown and draw the initial chart
  fetch("/states")
    .then((res) => res.json())
    .then((states) => {
      const dropdown = document.getElementById("stateSelector");
      states.forEach((state) => {
        const option = document.createElement("option");
        option.value = state;
        option.textContent = state;
        dropdown.appendChild(option);
      });
      dropdown.value = defaultState;
    })
    .catch((error) => {
      console.error("Error loading states for dropdown:", error);
    });

  fetch("/us_combo_data")
    // fetch the data for the combo chart
    .then((res) => res.json())
    .then((data) => {
      drawComboChart(
        data.us_monthly,
        {
          us: { co: data.us_trend.co, wind: data.us_trend.wind },
        },
        "#comboChart",
        "Comparison of CO Levels and Wind Speed Trends (2014–2024)",
        data.correlation
      );
    })
    .catch((error) => {
      console.error("Error loading us combo data:", error);
    });

  // Bar chart loading
  showLoader(loaders.bar);

  fetch("/state_averages")
    .then((res) => res.json())
    .then((data) => {
      fullDataSet = data.averages;
      drawGroupedBarChart({
        data: fullDataSet,
        correlation: data.correlation,
        containerId: "groupedBarChart",
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
      });
    })
    .catch((error) => {
      console.error("Error loading states bar chart averages:", error);
    })
    .finally(() => {
      hideLoader(loaders.bar);
    });

  fetch("/state_comparison", {
    // Trigger the state comparison fetch
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: defaultState }),
  })
    .then((res) => res.json())
    .then((data) => {
      document.getElementById(
        "stateTitle"
      ).textContent = `CO & Wind Trends – ${data.state}`;
      document.getElementById(
        "stWindRoseTitle"
      ).textContent = `Wind Rose Chart – ${data.state}`;
      const stateData = data.state_monthly.map((d) => ({
        ...d,
        date: new Date(d.date),
      }));
      const usData = data.us_monthly.map((d) => ({
        ...d,
        date: new Date(d.date),
      }));

      const coPrep = processChartData(stateData, "rolling_avg_co");
      const windPrep = processChartData(stateData, "rolling_avg_wind");

      drawSingleAxisChart({
        svgId: "#coChart",
        usData,
        stateData,
        usTrend: data.us_trend.co,
        stateTrend: data.state_trend.co,
        yAccessor: "rolling_avg_co",
        yLabel: "CO Concentration (PPM)",
        colorState: "darkred",
        colorUS: "black",
        title: `Carbon Monoxide: ${data.state} vs United States (2014–2024)`,
      });

      drawSingleAxisChart({
        svgId: "#windChart",
        usData,
        stateData,
        usTrend: data.us_trend.wind,
        stateTrend: data.state_trend.wind,
        yAccessor: "rolling_avg_wind",
        yLabel: "Wind Speed (mph)",
        colorState: "darkblue",
        colorUS: "black",
        title: `Wind Speed: ${data.state} vs United States (2014–2024)`,
      });
    });

  // Event listener for the dropdown
  document.getElementById("stateSelector").addEventListener("change", (e) => {
    const selectedState = e.target.value;
    // call windrose function
    loadWindRose(selectedState);

    // update comparison chart
    fetch("/state_comparison", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: selectedState }),
    })
      .then((res) => res.json())
      .then((data) => {
        document.getElementById(
          "stateTitle"
        ).textContent = `CO & Wind Trends – ${data.state}`;
        const stateData = data.state_monthly.map((d) => ({
          ...d,
          date: new Date(d.date),
        }));
        const usData = data.us_monthly.map((d) => ({
          ...d,
          date: new Date(d.date),
        }));

        drawSingleAxisChart({
          svgId: "#coChart",
          usData,
          stateData,
          usTrend: data.us_trend.co,
          stateTrend: data.state_trend.co,
          yAccessor: "rolling_avg_co",
          yLabel: "CO Concentration (PPM)",
          colorState: "darkred",
          colorUS: "black",
          title: `Carbon Monoxide: ${data.state} vs United States (2014–2024)`,
        });

        drawSingleAxisChart({
          svgId: "#windChart",
          usData,
          stateData,
          usTrend: data.us_trend.wind,
          stateTrend: data.state_trend.wind,
          yAccessor: "rolling_avg_wind",
          yLabel: "Wind Speed (mph)",
          colorState: "darkblue",
          colorUS: "black",
          title: `Wind Speed: ${data.state} vs United States (2014–2024)`,
        });
      })
      .catch((err) => {
        console.error("Failed to load comparison data:", err);
      });
  });
  // Load Treemap
  fetch("/treemap_data")
    .then((res) => res.json())
    .then((data) => {
      console.log("Treemap data:", data);

      drawTreemap(data, {
        valueAccessor: (d) => d.value,
        groupAccessor: (d) => d.region,
        labelAccessor: (d) => d.id,
        containerId: "treemapContainer",
        width: 800,
        height: 500,
      });
    })
    .catch((err) => {
      console.error("Failed to load legend data:", err);
    });

  const containerId = "treemapContainer";
  const color = d3
    .scaleOrdinal()
    .domain(Object.keys(regionColors))
    .range(Object.values(regionColors));

  renderLegend();
  updateTreemap();

  // Load seasonal data
  fetch("/seasonal_averages")
    .then((res) => {
      if (!res.ok) throw new Error("Network response was not ok");
      return res.json();
    })
    .then((data) => {
      console.log("Seasonal data loaded:", data);
      drawSeasonalComparisonChart({
        data: data.north,
        containerId: "northChart",
        regionTitle: "Northern States",
      });

      drawSeasonalComparisonChart({
        data: data.south,
        containerId: "southChart",
        regionTitle: "Southern States",
      });
    });

  loadWindRose(defaultState);

  // Animated wind rose
  fetch("/wind_rose/animated?type=wind")
    .then((res) => res.json())
    .then((data) => {
      console.log("Fetched animated wind rose data:", data);
      startStackedWindRoseAnimation(data);
    })
    .catch((err) => console.error("Failed to load animation data:", err));

  loadUSMapData("static")
    .then(() => drawMap("static"))
    .catch((err) =>
      console.error("US Map failed to load from both sources:", err)
    );

  // set map controls to hidden
  toggleAnimatedControlsVisibility(false);

  //end of DOMContentLoaded
});

// === Chart and utility functions ===
function degreesToCardinal(deg) {
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const index = Math.floor(((deg + 11.25) % 360) / 22.5);
  return directions[index];
}

// === Tooltip HTML Generators ===
function getCombinedTooltipHTML(stateMeta, coVal, wind, options = {}) {
  const lines = [];
  const label = options.label ?? "Avg (2014–2024)";
  //console.log("stateMeta properties:", Object.keys(stateMeta), stateMeta);
  if (stateMeta) {
    lines.push(`<strong>${stateMeta.name} (${stateMeta.abbr})</strong>`);
    if (label) lines.push(label);
  } else {
    lines.push("<strong>Unknown</strong>");
  }

  lines.push(
    `Avg CO: ${coVal != null ? coVal.toFixed(3) + " ppm" : "No data"}`
  );

  if (windOverlayActive) {
    if (wind) {
      const deg = wind.wind_direction;
      const dir = deg != null ? degreesToCardinal(deg) : "Unknown";
      lines.push(`<hr style="margin: 4px 0;">`);
      lines.push(`<strong>Wind:</strong>`);
      lines.push(`Speed: ${wind.wind_speed?.toFixed(2) ?? "?"} mph`);
      lines.push(
        `Direction: ${deg != null ? `${dir} (${deg.toFixed(0)}°)` : "No data"}`
      );
    } else {
      lines.push(`<hr style="margin: 4px 0;">`);
      lines.push(`<div><strong>Wind:</strong> No data</div>`);
    }
  }

  return lines.join("<br>");
}

// Function to add tooltip interactions
function addTooltipInteraction(
  svg,
  x,
  yLeft,
  yRight,
  mergedData,
  width,
  height
) {
  if (!mergedData || mergedData.length === 0) return;

  const tooltip = d3.select("#tooltip");

  const focusLine = svg
    .append("line")
    .attr("stroke", "#999")
    .attr("stroke-width", 1)
    .attr("y1", 0)
    .attr("y2", height)
    .style("opacity", 0);

  const coDot = svg
    .append("circle")
    .attr("r", 4)
    .attr("fill", "darkred")
    .style("opacity", 0);

  const windDot = svg
    .append("circle")
    .attr("r", 4)
    .attr("fill", "darkblue")
    .style("opacity", 0);

  svg
    .append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "none")
    .attr("pointer-events", "all")
    .on("mousemove", function (event) {
      const [mouseX] = d3.pointer(event);
      const hoveredDate = x.invert(mouseX);

      const bisectDate = d3.bisector((d) => d.date).left;
      const i = bisectDate(mergedData, hoveredDate, 1);
      const d0 = mergedData[i - 1];
      const d1 = mergedData[i];
      const d =
        !d0 || !d1
          ? d0 || d1
          : hoveredDate - d0.date > d1.date - hoveredDate
          ? d1
          : d0;

      if (!d || d.co == null || d.wind == null) return;

      tooltip
        .style("visibility", "visible")
        .html(
          `
              <strong>${d3.timeFormat("%B %Y")(d.date)}</strong><br>
              CO: ${d.co.toFixed(3)} ppm<br>
              Wind: ${d.wind.toFixed(2)} mph
            `
        )
        .style("top", event.pageY - 50 + "px")
        .style("left", event.pageX + 20 + "px");

      const xPos = x(d.date);
      focusLine.attr("x1", xPos).attr("x2", xPos).style("opacity", 1);
      coDot.attr("cx", xPos).attr("cy", yLeft(d.co)).style("opacity", 1);
      windDot.attr("cx", xPos).attr("cy", yRight(d.wind)).style("opacity", 1);
    })
    .on("mouseout", () => {
      tooltip.style("visibility", "hidden");
      focusLine.style("opacity", 0);
      coDot.style("opacity", 0);
      windDot.style("opacity", 0);
    });
}

// Function to add single axis tooltip
function addSingleAxisTooltip(
  g, // used to be svg
  x,
  y,
  usData,
  stateData,
  yAccessor,
  label,
  colorUS,
  colorState,
  fullWidth,
  fullHeight
) {
  const tooltip = d3.select("#tooltip");

  const usDot = g
    .append("circle")
    .attr("r", 4)
    .attr("fill", colorUS)
    .style("opacity", 0);

  const stateDot = g
    .append("circle")
    .attr("r", 4)
    .attr("fill", colorState)
    .style("opacity", 0);

  const focusLine = g
    .append("line")
    .attr("stroke", "#999")
    .attr("stroke-width", 1)
    .attr("y1", 0)
    .attr("y2", fullHeight) // or height of the inner plot area
    .style("opacity", 0);

  g.append("rect")
    .attr("width", fullWidth) // or chart area width
    .attr("height", fullHeight) // or chart area height
    .attr("fill", "none")
    .attr("pointer-events", "all")
    .on("mousemove", function (event) {
      const [mouseX] = d3.pointer(event);
      const hoveredDate = x.invert(mouseX);
      const bisectDate = d3.bisector((d) => d.date).left;

      const i = bisectDate(stateData, hoveredDate, 1);
      const d0 = stateData[i - 1];
      const d1 = stateData[i];
      const statePoint =
        !d0 || !d1
          ? d0 || d1
          : hoveredDate - d0.date > d1.date - hoveredDate
          ? d1
          : d0;

      if (!statePoint || statePoint[yAccessor] == null) return;

      const usPoint = usData.find(
        (d) => d.date.getTime() === statePoint.date.getTime()
      );

      if (!usPoint || usPoint[yAccessor] == null) return;

      const xPos = x(statePoint.date);
      focusLine.attr("x1", xPos).attr("x2", xPos).style("opacity", 1);

      usDot
        .attr("cx", xPos)
        .attr("cy", y(usPoint[yAccessor]))
        .style("opacity", 1);

      stateDot
        .attr("cx", xPos)
        .attr("cy", y(statePoint[yAccessor]))
        .style("opacity", 1);

      tooltip
        .style("visibility", "visible")
        .html(
          `
                <strong>${d3.timeFormat("%B %Y")(statePoint.date)}</strong><br>
                <span style="color:${colorUS}">US ${label}:</span> ${usPoint[
            yAccessor
          ].toFixed(2)}<br>
                <span style="color:${colorState}">State ${label}:</span> ${statePoint[
            yAccessor
          ].toFixed(2)}
              `
        )
        .style("top", event.pageY - 50 + "px")
        .style("left", event.pageX + 20 + "px");
    })
    .on("mouseout", () => {
      tooltip.style("visibility", "hidden");
      focusLine.style("opacity", 0);
      usDot.style("opacity", 0);
      stateDot.style("opacity", 0);
    });
}
// Function to draw the combo line chart
function drawComboChart(data, trends, svgId, title, correlation) {
  const svg = d3.select(svgId);
  if (svg.empty()) {
    console.error(`SVG element not found for selector: ${svgId}`);
    return;
  }
  svg.selectAll("*").remove();

  const margin = { top: 60, right: 60, bottom: 60, left: 70 };
  const width = +svg.attr("width") - margin.left - margin.right;
  const height = +svg.attr("height") - margin.top - margin.bottom;

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  data.forEach((d) => {
    d.date = new Date(d.date);
  });

  // filter out null values
  const coData = data.filter((d) => d.rolling_avg_co != null);
  const windData = data.filter((d) => d.rolling_avg_wind != null);

  const domainData = data.filter(
    (d) => d.rolling_avg_co != null && d.rolling_avg_wind != null
  );

  const xMin = d3.min(domainData, (d) => d.date);
  const xMax = d3.max(domainData, (d) => d.date);

  const x = d3
    .scaleTime()
    .domain(d3.extent(data, (d) => d.date))
    .range([0, width]);

  const yLeft = d3
    .scaleLinear()
    .domain(d3.extent(data, (d) => d.rolling_avg_co))
    .nice()
    .range([height, 0]);

  const yRight = d3
    .scaleLinear()
    .domain(d3.extent(data, (d) => d.rolling_avg_wind))
    .nice()
    .range([height, 0]);

  const lineCO = d3
    .line()
    .defined((d) => d.rolling_avg_co != null)
    .x((d) => x(d.date))
    .y((d) => yLeft(d.rolling_avg_co));

  const lineWind = d3
    .line()
    .defined((d) => d.rolling_avg_wind != null)
    .x((d) => x(d.date))
    .y((d) => yRight(d.rolling_avg_wind));

  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x));

  g.append("text")
    .attr("x", width / 2)
    .attr("y", height + 40)
    .attr("text-anchor", "middle")
    .style("font-weight", "bold")
    .text("Year");

  g.append("g")
    .call(d3.axisLeft(yLeft))
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("y", -5)
    .attr("x", -height / 2)
    .attr("dy", "-3em")
    .attr("text-anchor", "middle")
    .attr("fill", "darkred")
    .style("font-size", "14px")
    .style("font-weight", "bold")
    .text("CO (PPM)");

  g.append("g")
    .attr("transform", `translate(${width},0)`)
    .call(d3.axisRight(yRight))
    .append("text")
    .attr("transform", "rotate(90)")
    .attr("y", -80)
    .attr("x", height / 2)
    .attr("dy", "3em")
    .attr("text-anchor", "middle")
    .attr("fill", "darkblue")
    .style("font-size", "14px")
    .style("font-weight", "bold")
    .text("Wind Speed (mph)");

  // Lines
  g.append("path")
    .datum(coData)
    .attr("fill", "none")
    .attr("stroke", "darkred")
    .attr("stroke-width", 2.5)
    .attr("d", lineCO);

  g.append("path")
    .datum(windData)
    .attr("fill", "none")
    .attr("stroke", "darkblue")
    .attr("stroke-width", 2.5)
    .attr("d", lineWind);

  // Title
  svg
    .append("text")
    .attr("x", +svg.attr("width") / 2)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text(title);

  //   // Correlation label
  //   svg
  //     .append("text")
  //     .attr("x", margin.left + 5)
  //     .attr("y", +svg.attr("height") - 15)
  //     .style("font-size", "13px")
  //     .style("opacity", 0.8)
  //     .text(`Correlation coefficient: ${correlation.toFixed(3)}`);

  // Legend
  const legendItems = [
    { color: "darkred", label: "CO (12-Month Avg)" },
    { color: "darkblue", label: "Wind Speed (12-Month Avg)" },
  ];
  const legend = svg
    .append("g")
    .attr("transform", `translate(${+svg.attr("width") - 250}, 50)`);
  legendItems.forEach((item, i) => {
    const row = legend.append("g").attr("transform", `translate(0, ${i * 20})`);
    row
      .append("rect")
      .attr("width", 12)
      .attr("height", 12)
      .attr("fill", item.color);
    row
      .append("text")
      .attr("x", 16)
      .attr("y", 10)
      .text(item.label)
      .style("font-size", "12px");
  });

  // Trend line toggle
  addTrendlineToggle({
    checkboxId: "toggleTrends",
    svg: g,
    xScale: x,
    yScale: [yLeft, yRight],
    xDomain: [xMin, xMax],
    trends: [{ trend: trends.us.co }, { trend: trends.us.wind }],
    trendColors: ["darkred", "darkblue"],
  });

  // Tooltip
  const merged = [];

  const windByDate = new Map(
    windData.map((d) => [d.date.getTime(), d.rolling_avg_wind])
  );

  coData.forEach((coPoint) => {
    const windVal = windByDate.get(coPoint.date.getTime());
    if (windVal !== undefined) {
      merged.push({
        date: coPoint.date,
        co: coPoint.rolling_avg_co,
        wind: windVal,
      });
    }
  });
  addTooltipInteraction(g, x, yLeft, yRight, merged, width, height);
}

// Function to draw a single axis chart
function drawSingleAxisChart({
  svgId,
  usData,
  stateData,
  usTrend,
  stateTrend,
  yAccessor,
  yLabel,
  colorState,
  colorUS,
  title,
}) {
  const svg = d3.select(svgId);
  svg.selectAll("*").remove();

  // set up dimensions
  const fullWidth = 600;
  const fullHeight = 400;

  const unitMatch = yLabel.match(/\(([^)]+)\)/); // grabs text in parentheses
  const unit = unitMatch ? unitMatch[1] : "";

  svg
    .attr("viewBox", `0 0 ${fullWidth} ${fullHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "auto")
    .classed("svg-content", true);

  // set up margins
  const margin = { top: 60, right: 40, bottom: 50, left: 60 };
  const width = fullWidth - margin.left - margin.right;
  const height = fullHeight - margin.top - margin.bottom;

  // create the SVG group
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  usData.forEach((d) => (d.date = new Date(d.date)));
  stateData.forEach((d) => (d.date = new Date(d.date)));

  const x = d3
    .scaleTime()
    .domain(d3.extent(usData, (d) => d.date))
    .range([0, width]);

  const y = d3
    .scaleLinear()
    .domain([
      d3.min([...usData, ...stateData], (d) => d[yAccessor]),
      d3.max([...usData, ...stateData], (d) => d[yAccessor]),
    ])
    .nice()
    .range([height, 0]);

  const lineUS = d3
    .line()
    .defined((d) => d[yAccessor] != null)
    .x((d) => x(d.date))
    .y((d) => y(d[yAccessor]));

  const lineState = d3
    .line()
    .defined((d) => d[yAccessor] != null)
    .x((d) => x(d.date))
    .y((d) => y(d[yAccessor]));

  // US line
  g.append("path")
    .datum(usData)
    .attr("fill", "none")
    .attr("stroke", colorUS)
    .attr("stroke-width", 2)
    .attr("d", lineUS);

  // State line
  g.append("path")
    .datum(stateData)
    .attr("fill", "none")
    .attr("stroke", colorState)
    .attr("stroke-width", 2)
    .attr("d", lineState);

  // Trend lines
  addTrendlineToggle({
    checkboxId:
      yAccessor === "rolling_avg_co" ? "toggleCOTrend" : "toggleWindTrend",
    svg: g,
    xScale: x,
    yScale: [y, y],
    xDomain: x.domain(),
    trends: [{ trend: usTrend }, { trend: stateTrend }],
    trendColors: [colorUS, colorState],
  });

  // Axes
  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).tickSizeOuter(0));

  g.append("g").call(d3.axisLeft(y));

  // Y Label
  svg
    .append("text")
    .attr("transform", `rotate(-90)`)
    .attr("x", -fullHeight / 2)
    .attr("y", 20) // push it rightward
    .attr("text-anchor", "middle")
    .style("font-weight", "bold")
    .text(yLabel);

  // X Label
  svg
    .append("text")
    .attr("x", fullWidth / 2)
    .attr("y", fullHeight - 10)
    .attr("text-anchor", "middle")
    .style("font-weight", "bold")
    .text("Year");

  // Title
  svg
    .append("text")
    .attr("x", fullWidth / 2)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text(title);

  // Legend
  const legend = svg
    .append("g")
    .attr("transform", `translate(${fullWidth - 160}, ${margin.top})`)
    .style("font-size", "12px")
    .style("dominant-baseline", "middle");

  const legendItems = [
    { label: "United States", color: colorUS },
    {
      label: `${title.split(":")[1].split("vs")[0].trim()}`,
      color: colorState,
    },
  ];

  legendItems.forEach((item, i) => {
    const row = legend.append("g").attr("transform", `translate(0, ${i * 20})`);

    row
      .append("rect")
      .attr("width", 12)
      .attr("height", 12)
      .attr("fill", item.color);

    row
      .append("text")
      .attr("x", 18)
      .attr("y", 10)
      .text(item.label)
      .style("font-size", "12px");
  });

  // === Trend Delta Display ===
  // const slopeState = (stateTrend?.slope ?? 0) * 12;
  // const slopeUS = (usTrend?.slope ?? 0) * 12;
  // const formatDelta = (val) =>
  //   `${val >= 0 ? "+" : ""}${val.toFixed(4)} ${unit}/yr`;

  // const trendTextLines = [
  //   `Trend Delta (slope):`,
  //   `${legendItems[1].label}: ${formatDelta(slopeState)}`,
  //   `United States: ${formatDelta(slopeUS)}`,
  // ];

  // const deltaBox = svg
  //   .append("g")
  //   .attr(
  //     "transform",
  //     `translate(${fullWidth - 200}, ${fullHeight - margin.bottom - 60})`
  //   );

  // deltaBox
  //   .append("rect")
  //   .attr("width", 170)
  //   .attr("height", 48)
  //   .attr("rx", 6)
  //   .attr("ry", 6)
  //   .attr("fill", "#f9f9f9")
  //   .attr("stroke", "#ccc")
  //   .attr("stroke-width", 1);

  // trendTextLines.forEach((line, i) => {
  //   deltaBox
  //     .append("text")
  //     .attr("x", 8)
  //     .attr("y", 16 + i * 14)
  //     .text(line)
  //     .style("font-size", "11px")
  //     .style("font-family", "sans-serif")
  //     .style("fill", "#333");
  // });

  // Tooltip
  addSingleAxisTooltip(
    g,
    x,
    y,
    usData.filter((d) => d[yAccessor] != null),
    stateData.filter((d) => d[yAccessor] != null),
    yAccessor,
    yLabel,
    colorUS,
    colorState,
    fullWidth,
    fullHeight
  );
}

// Function to draw trend lines
function drawTrendLine(svg, xScale, yScale, xDomain, trend, color) {
  if (
    !trend ||
    typeof trend.slope !== "number" ||
    typeof trend.intercept !== "number"
  ) {
    console.warn("Invalid trend data:", trend);
    return;
  }

  const [xMin, xMax] = xDomain;
  const xMinTs = xMin.getTime() / 1000;
  const xMaxTs = xMax.getTime() / 1000;

  const yMin = trend.slope * xMinTs + trend.intercept;
  const yMax = trend.slope * xMaxTs + trend.intercept;

  svg
    .append("line")
    .attr("class", "trendline")
    .attr("x1", xScale(xMin))
    .attr("y1", yScale(yMin))
    .attr("x2", xScale(xMax))
    .attr("y2", yScale(yMax))
    .attr("stroke", color)
    .attr("stroke-dasharray", "6 4")
    .attr("stroke-width", 1.5);
}

// Function to toggle trend lines
function addTrendlineToggle({
  checkboxId,
  svg,
  xScale,
  yScale,
  xDomain,
  trends,
  trendColors,
}) {
  const checkbox = document.getElementById(checkboxId);
  if (!checkbox) return;

  const drawAllTrends = () => {
    trends.forEach((t, i) => {
      drawTrendLine(svg, xScale, yScale[i], xDomain, t.trend, trendColors[i]);
    });
  };

  checkbox.onchange = () => {
    svg.selectAll(".trendline").remove();
    if (checkbox.checked) {
      drawAllTrends();
    }
  };

  // Draw once if initially checked
  if (checkbox.checked) {
    drawAllTrends();
  }
}

// Function to preprocess chart data
function processChartData(rawData, valueKey) {
  const parsedData = rawData.map((d) => ({
    ...d,
    date: new Date(d.date),
    value: d[valueKey] !== null ? +d[valueKey] : null,
  }));

  const filteredData = parsedData.filter((d) => d.value != null);
  const xDomain = d3.extent(filteredData, (d) => d.date);
  const yDomain = d3.extent(filteredData, (d) => d.value);

  return { data: parsedData, filteredData, xDomain, yDomain };
}

// Function to Draw Treemap
function drawTreemap(data, options = {}) {
  const {
    valueAccessor = (d) => d.value,
    groupAccessor = (d) => d.region,
    labelAccessor = (d) => d.id,
    containerId = "treemapContainer",
    width = 800,
    height = 500,
  } = options;

  // Build hierarchy
  const root = d3
    .stratify()
    .id((d) => d.id)
    .parentId((d) => d.parentId)(data);

  root.sum((d) => valueAccessor(d));

  // Create treemap layout
  d3.treemap().size([width, height]).padding(1).round(true)(root);

  // Select container
  const container = d3.select(`#${containerId}`);
  container.selectAll("*").remove(); // clear existing

  // Tooltip
  const tooltip = d3.select("#tooltip");
  const svg = container
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width)
    .attr("height", height)
    .style("font-family", "sans-serif")
    .style("font-size", "14px");

  const color = d3
    .scaleOrdinal()
    .domain(Object.keys(regionColors))
    .range(Object.values(regionColors));

  const node = svg
    .selectAll("g")
    .data(root.leaves())
    .enter()
    .append("g")
    .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

  // Calculate CO min/max for opacity scaling
  const valueExtent = d3.extent(data, valueAccessor);
  const opacityScale = d3.scaleLinear().domain(valueExtent).range([0.5, 1]); // optional tweak: [0.3, 1]

  // Apply color AND opacity
  node
    .append("rect")
    .attr("width", (d) => d.x1 - d.x0)
    .attr("height", (d) => d.y1 - d.y0)
    .attr("fill", (d) => {
      const isRootOnly = data.length === 1 && d.data.parentId === "";
      return isRootOnly ? "#ccc" : color(groupAccessor(d.data));
    })
    .attr("fill-opacity", (d) => {
      const val = valueAccessor(d.data);
      return val != null ? opacityScale(val) : 0.2;
    });

  node
    .append("text")
    .attr("x", 4)
    .attr("y", 13)
    .text(
      (d) => `${d.data.id}: 
    (${d.data.value})`
    )
    .attr("fill", "white")
    .style("pointer-events", "none")
    .style("font-size", "10px");

  const isRootOnly = data.length === 1 && data[0].parentId === "";

  // Add tooltip interaction
  node
    .on("mouseover", (event, d) => {
      tooltip.style("visibility", "visible");

      if (isRootOnly && d.data.parentId === "") {
        tooltip.html(`
          <strong>Please select a region</strong><br>
          or click <em>Reset</em> to see all data.
        `);
      } else {
        tooltip.html(`
          <strong>${labelAccessor(d.data)}</strong><br>
          Region: ${d.data.region}<br>
          CO Level: ${valueAccessor(d.data).toFixed(2)} ppm
        `);
      }
    })
    .on("mousemove", (event) => {
      tooltip
        .style("top", event.pageY - 40 + "px")
        .style("left", event.pageX + 15 + "px");
    })
    .on("mouseout", () => {
      tooltip.style("visibility", "hidden");
    });

  svg
    .selectAll("rect")
    .on("mouseover", (event, d) => {
      tooltip
        .style("visibility", "visible")
        .select(".tooltip-title")
        .text(d.data.id);

      tooltip.select(".tooltip-region").text(`Region: ${d.data.region}`);

      tooltip.select(".tooltip-value").text(`CO Level: ${d.data.value} ppm`);
    })
    .on("mousemove", (event) => {
      tooltip
        .style("top", event.pageY - 40 + "px")
        .style("left", event.pageX + 15 + "px");
    })
    .on("mouseout", () => tooltip.style("visibility", "hidden"));
}

// === Treemap Legend Renderer ===
function renderLegend() {
  const container = d3.select("#legendContainer");
  container.selectAll("*").remove();
  const containerId = "treemapContainer";

  const legendItems = container
    .selectAll(".legend-item")
    .data(Object.keys(regionColors))
    .enter()
    .append("div")
    .attr("class", "legend-item d-inline-flex align-items-center mx-2")
    .style("cursor", "pointer")
    .on("click", (event, region) => {
      toggleRegion(region);
    });

  legendItems
    .append("div")
    .attr("class", "legend-color")
    .style("width", "14px")
    .style("height", "14px")
    .style("margin-right", "6px")
    .style("border-radius", "3px")
    .style("background-color", (d) => regionColors[d])
    .style("opacity", (d) => (selectedRegions.has(d) ? 1 : 0.3));

  legendItems
    .append("span")
    .text((d) => `${d} ${selectedRegions.has(d) ? "✓" : ""}`)
    .style("opacity", (d) => (selectedRegions.has(d) ? 1 : 0.5));

  // Reset button
  container
    .append("button")
    .text("Reset")
    .attr("class", "btn btn-sm btn-outline-secondary")
    .on("click", () => {
      showLoader(loaders.treemap);
      selectedRegions = new Set(Object.keys(regionColors));
      updateTreemap();
      renderLegend();
    });
}

// === Treemap Data Updater ===
function toggleRegion(region) {
  // show the loader before updating anything
  showLoader(loaders.treemap);

  if (selectedRegions.has(region)) {
    selectedRegions.delete(region);
  } else {
    selectedRegions.add(region);
  }

  updateTreemap(); // already has loader .finally()
  renderLegend(); // refresh checkmarks
}

function updateTreemap() {
  // loader container
  showLoader(loaders.treemap);

  fetch("/treemap_data")
    .then((res) => res.json())
    .then((data) => {
      const filtered = data.filter(
        (d) => d.parentId === "" || selectedRegions.has(d.region)
      );

      drawTreemap(filtered, {
        containerId: "treemapContainer",
        valueAccessor: (d) => d.value,
        groupAccessor: (d) => d.region,
        labelAccessor: (d) =>
          `${d.id}
    ${d.value != null ? d.value.toFixed(2) + " ppm" : ""}`,
        width: 800,
        height: 500,
      });
    })
    .catch((err) => {
      console.error("Treemap load error:", err);
    })
    .finally(() => {
      // Hide loader after drawing is done
      hideLoader(loaders.treemap);
    });
}

function drawGroupedBarChart({
  data,
  correlation,
  containerId,
  width = CHART_WIDTH,
  height = CHART_HEIGHT,
}) {
  // Recalculate trend line on every draw
  const wind = data.map((d) => d.avg_wind_speed);
  const co = data.map((d) => d.avg_measurement);
  const trend = getTrendLine(wind, co);

  if (correlation === undefined || isNaN(correlation)) {
    correlation = getCorrelation(wind, co);
  }

  const windExtent = d3.extent(wind);
  const trendLineData = windExtent.map((w) => ({
    wind: w,
    co: trend.slope * w + trend.intercept,
  }));

  const svg = d3.select(`#${containerId}`);
  svg.selectAll("*").remove();
  svg
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const margin = { top: 100, right: 80, bottom: 120, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x0 = d3
    .scaleBand()
    .domain(data.map((d) => d.state))
    .range([0, chartWidth])
    .padding(0.2);

  const x1 = d3
    .scaleBand()
    .domain(["wind", "co"])
    .range([0, x0.bandwidth()])
    .padding(0.1);

  const yLeft = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.avg_wind_speed)])
    .nice()
    .range([chartHeight, 0]);

  const yRight = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.avg_measurement)])
    .nice()
    .range([chartHeight, 0]);

  const tooltip = d3.select("#tooltip");

  const top3CO = new Set(
    data
      .sort((a, b) => b.avg_measurement - a.avg_measurement)
      .slice(0, 3)
      .map((d) => d.state)
  );
  const bottom3CO = new Set(
    data
      .sort((a, b) => a.avg_measurement - b.avg_measurement)
      .slice(0, 3)
      .map((d) => d.state)
  );
  const top3Wind = new Set(
    data
      .sort((a, b) => b.avg_wind_speed - a.avg_wind_speed)
      .slice(0, 3)
      .map((d) => d.state)
  );
  const bottom3Wind = new Set(
    data
      .sort((a, b) => a.avg_wind_speed - b.avg_wind_speed)
      .slice(0, 3)
      .map((d) => d.state)
  );

  const stateGroups = g
    .selectAll(".state-group")
    .data(data)
    .enter()
    .append("g")
    .attr("class", "state-group")
    .attr("transform", (d) => `translate(${x0(d.state)},0)`);

  stateGroups
    .selectAll("rect")
    .data((d) => {
      const windColor = top3Wind.has(d.state)
        ? colorMap.windTop3
        : bottom3Wind.has(d.state)
        ? colorMap.windBottom3
        : colorMap.windDefault;

      const coColor = top3CO.has(d.state)
        ? colorMap.coTop3
        : bottom3CO.has(d.state)
        ? colorMap.coBottom3
        : colorMap.coDefault;

      return [
        {
          key: "wind",
          value: d.avg_wind_speed,
          state: d.state,
          color: windColor,
          stroke:
            top3Wind.has(d.state) || bottom3Wind.has(d.state)
              ? colorMap.windDefault
              : "none",
        },
        {
          key: "co",
          value: d.avg_measurement,
          state: d.state,
          color: coColor,
          stroke:
            top3CO.has(d.state) || bottom3CO.has(d.state)
              ? colorMap.coDefault
              : "none",
        },
      ];
    })
    .enter()
    .append("rect")
    .attr("x", (d) => x1(d.key))
    .attr("y", (d) => (d.key === "wind" ? yLeft(d.value) : yRight(d.value)))
    .attr("width", x1.bandwidth())
    .attr("height", (d) =>
      d.key === "wind"
        ? chartHeight - yLeft(d.value)
        : chartHeight - yRight(d.value)
    )
    .attr("fill", (d) => d.color)
    .on("mouseover", (event, d) => {
      tooltip.style("visibility", "visible").html(`
            <strong>${d.state}</strong><br>
            ${d.key === "wind" ? "Wind Speed" : "CO"}: ${d.value.toFixed(2)}
          `);
    })
    .on("mousemove", (event) => {
      tooltip
        .style("top", event.pageY - 50 + "px")
        .style("left", event.pageX + 20 + "px");
    })
    .on("mouseout", () => tooltip.style("visibility", "hidden"));

  // Add brush filter
  brush = d3
    .brushX()
    .extent([
      [0, 0],
      [chartWidth, chartHeight],
    ])
    .on("end", brushed);

  brushGroup = g.append("g").attr("class", "brush").call(brush).lower();

  // Add the trend line

  g.append("line")
    .datum(trendLineData)
    .attr("x1", x0(data[0].state))
    .attr("y1", yRight(trendLineData[0].co))
    .attr("x2", x0(data[data.length - 1].state) + x0.bandwidth())
    .attr("y2", yRight(trendLineData[1].co))
    .attr("stroke", "black")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "6 4");

  // Axes
  g.append("g")
    .attr("transform", `translate(0,${chartHeight})`)
    .call(d3.axisBottom(x0))
    .selectAll("text")
    .attr("transform", "rotate(-45)")
    .style("text-anchor", "end")
    .style("font-size", "12px")
    .style("font-weight", "bold")
    .style("font-family", "sans-serif");

  g.append("g").call(d3.axisLeft(yLeft));

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -chartHeight / 2)
    .attr("y", -margin.left + 10)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("font-weight", "bold")
    .attr("fill", "darkblue")
    .text("Wind Speed (mph)");

  g.append("g")
    .attr("transform", `translate(${chartWidth}, 0)`)
    .call(d3.axisRight(yRight));

  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", width - 10)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("font-weight", "bold")
    .attr("fill", "darkred")
    .text("CO Concentration (PPM)");

  // Title
  svg
    .append("text")
    .attr("x", width / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .style("font-weight", "bold")
    .style("font-size", "18px")
    .text("Average Wind Speed & CO Levels by State (2014–2024)");

  //   svg
  //     .append("text")
  //     .attr("x", margin.left)
  //     .attr("y", 50)
  //     .style("font-size", "16px")
  //     .text(() =>
  //       correlation
  //         ? `Correlation (Wind → CO): ${correlation.toFixed(3)}`
  //         : "(Filtered view — correlation not shown)"
  //     );

  // Shifted legend lower to avoid title overlap
  const legendItems = [
    { label: "Wind Speed", color: colorMap.windDefault },
    { label: "CO Level", color: colorMap.coDefault },
    { label: "Top 3 Wind", color: colorMap.windTop3 },
    { label: "Top 3 CO", color: colorMap.coTop3 },
    { label: "Bottom 3 Wind", color: colorMap.windBottom3 },
    { label: "Bottom 3 CO", color: colorMap.coBottom3 },
    { label: "Trend Line", dashed: true },
  ];

  const legend = svg
    .append("g")
    .attr("transform", `translate(${width / 2 - 180}, ${margin.top - 30})`);

  const legendCols = 2;
  const legendSpacingX = 160;
  const legendSpacingY = 20;

  legendItems.forEach((item, i) => {
    const col = i % legendCols;
    const row = Math.floor(i / legendCols);
    const group = legend
      .append("g")
      .attr(
        "transform",
        `translate(${col * legendSpacingX}, ${row * legendSpacingY})`
      );

    if (item.dashed) {
      group
        .append("line")
        .attr("x1", 0)
        .attr("y1", 6)
        .attr("x2", 14)
        .attr("y2", 6)
        .attr("stroke", "gray")
        .attr("stroke-dasharray", "4 2")
        .attr("stroke-width", 2);
    } else {
      group
        .append("rect")
        .attr("width", 12)
        .attr("height", 12)
        .attr("fill", item.color);
    }

    group
      .append("text")
      .attr("x", 18)
      .attr("y", 10)
      .text(item.label)
      .style("font-size", "12px");
  });

  function brushed(event) {
    const selection = event.selection;
    if (!selection) return;

    const [x0Brush, x1Brush] = selection;

    // Filter states that fall within brush bounds
    const brushedStates = data.filter((d) => {
      const pos = x0(d.state) + x0.bandwidth() / 2;
      return pos >= x0Brush && pos <= x1Brush;
    });

    if (brushedStates.length === 0) return;

    // Redraw chart with filtered states
    drawGroupedBarChart({
      data: brushedStates,
      correlation: null,
      containerId,
      width,
      height,
    });
  }

  hideLoader(loaders.bar);
}

function getTrendLine(xVals, yVals) {
  const n = xVals.length;
  const sumX = d3.sum(xVals);
  const sumY = d3.sum(yVals);
  const sumXY = d3.sum(xVals.map((x, i) => x * yVals[i]));
  const sumX2 = d3.sum(xVals.map((x) => x * x));

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

document.addEventListener("click", function (event) {
  const clickedInsideChart = event.target.closest("svg#groupedBarChart");

  if (!clickedInsideChart && fullDataSet) {
    // Recalculate trend + rebuild full chart
    const wind = fullDataSet.map((d) => d.avg_wind_speed);
    const co = fullDataSet.map((d) => d.avg_measurement);
    const trend = getTrendLine(wind, co);

    drawGroupedBarChart({
      data: fullDataSet,
      correlation: fullDataSet.correlation,
      containerId: "groupedBarChart",
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
    });
  }
});

// Function to draw seasonal comparison chart
function drawSeasonalComparisonChart({
  data,
  containerId,
  regionTitle,
  width = 420,
  height = 260,
}) {
  const margin = { top: 60, right: 60, bottom: 60, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const svg = d3
    .select(`#${containerId}`)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const tooltip = d3.select("#tooltip");

  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.season))
    .range([0, chartWidth])
    .padding(0.2);

  const yLeft = d3
    .scaleLinear()
    .domain([0, 0.35]) // dynamic disabled d3.max(data, (d) => d.avg_measurement)])
    .nice()
    .range([chartHeight, 0]);

  const yRight = d3
    .scaleLinear()
    .domain([0, 40]) // dynamic disabled d3.max(data, (d) => d.avg_wind_speed)])
    .nice()
    .range([chartHeight, 0]);

  g.append("g")
    .attr("transform", `translate(0,${chartHeight})`)
    .call(d3.axisBottom(x));

  g.append("g").call(d3.axisLeft(yLeft));

  g.append("g")
    .attr("transform", `translate(${chartWidth}, 0)`)
    .call(d3.axisRight(yRight));

  // CO Bars
  g.selectAll(".co-bar")
    .data(data)
    .enter()
    .append("rect")
    .attr("class", "co-bar")
    .attr("x", (d) => x(d.season))
    .attr("y", (d) => yLeft(d.avg_measurement))
    .attr("width", x.bandwidth() / 2)
    .attr("height", (d) => chartHeight - yLeft(d.avg_measurement))
    .attr("fill", "darkred")
    .on("mouseover", (event, d) => {
      tooltip
        .style("visibility", "visible")
        .html(
          `<strong>${d.season}</strong><br>CO: ${d.avg_measurement.toFixed(
            3
          )} PPM`
        );
    })
    .on("mousemove", (event) => {
      tooltip
        .style("top", `${event.pageY - 40}px`)
        .style("left", `${event.pageX + 15}px`);
    })
    .on("mouseout", () => tooltip.style("visibility", "hidden"));

  // Wind Bars
  g.selectAll(".wind-bar")
    .data(data)
    .enter()
    .append("rect")
    .attr("class", "wind-bar")
    .attr("x", (d) => x(d.season) + x.bandwidth() / 2)
    .attr("y", (d) => yRight(d.avg_wind_speed))
    .attr("width", x.bandwidth() / 2)
    .attr("height", (d) => chartHeight - yRight(d.avg_wind_speed))
    .attr("fill", "darkblue")
    .on("mouseover", (event, d) => {
      tooltip
        .style("visibility", "visible")
        .html(
          `<strong>${d.season}</strong><br>Wind: ${d.avg_wind_speed.toFixed(
            1
          )} mph`
        );
    })
    .on("mousemove", (event) => {
      tooltip
        .style("top", `${event.pageY - 40}px`)
        .style("left", `${event.pageX + 15}px`);
    })
    .on("mouseout", () => tooltip.style("visibility", "hidden"));

  // Title
  svg
    .append("text")
    .attr("x", width / 2)
    .attr("y", 25)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "bold")
    .text(`${regionTitle}: Seasonal Comparison`);

  // Axis Labels
  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", 15)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .style("font-weight", "bold")
    .attr("fill", "darkred")
    .text("CO Concentration (PPM)");

  svg
    .append("text")
    .attr("transform", "rotate(90)")
    .attr("x", height / 2)
    .attr("y", -width + 20)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .style("font-weight", "bold")
    .attr("fill", "darkblue")
    .text("Wind Speed (mph)");
}

// Load windrose data
function loadWindRose(state) {
  fetch("/wind_rose", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
  })
    .then((res) => res.json())
    .then((data) => {
      console.log("Wind rose data:", data);
      drawWindRose("#windRoseChart", data);
      drawWindLegend("#stWindRoseLegend");
    })
    .catch((error) => console.error("Error loading wind rose data:", error));
}

// Function to handle mouseover event
function handleMouseOver(event, d) {
  const bin = d.data.direction_bin;
  const deg = Math.round(bin * 22.5);
  const label = `${degreesToCardinal(deg)} (${deg}°)`;
  const value = d[1] - d[0];

  d3.select("#tooltip").style("visibility", "visible").html(`
      <strong>${label}</strong><br>
      Value: ${value}
    `);
}

function handleMouseMove(event) {
  d3.select("#tooltip")
    .style("top", event.pageY - 50 + "px")
    .style("left", event.pageX + 20 + "px");
}

function handleMouseOut() {
  d3.select("#tooltip").style("visibility", "hidden");
}

// Function to draw wind rose chart
function drawWindRose(containerId, data) {
  const container = d3.select(containerId);
  container.selectAll("*").remove(); // Clear previous chart

  const width = 500;
  const height = 500;
  const margin = 40;
  const radius = Math.min(width, height) / 2 - margin;

  const svg = container
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .append("g")
    .attr("transform", `translate(${width / 2},${height / 2})`);

  const directionLabels = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];

  const speedOrder = [
    "Light (<10)",
    "Moderate (10-20)",
    "Strong (20-30)",
    "Very Strong (30-40)",
    "Extreme (>40)",
  ];

  const colorScale = d3
    .scaleOrdinal()
    .domain(speedOrder)
    .range(["#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"]);

  // Stack the data by speed category
  const stackedData = d3
    .stack()
    .keys(speedOrder)
    .value((d, key) => d[key] || 0)(data);

  const angleScale = d3
    .scaleBand()
    .domain(data.map((d) => d.direction_bin))
    .range([0, 2 * Math.PI]);

  const radiusScale = d3
    .scaleLinear()
    .domain([0, d3.max(stackedData[stackedData.length - 1], (d) => d[1])])
    .range([0, radius]);

  function arcPath(d, j, radiusScale, angleScale) {
    const a0 = angleScale(d.data.direction_bin);
    const a1 = a0 + angleScale.bandwidth();
    const r0 = radiusScale(d[0]);
    const r1 = radiusScale(d[1]);

    return d3
      .arc()
      .innerRadius(r0)
      .outerRadius(r1)
      .startAngle(a0)
      .endAngle(a1)();
  }

  // Draw layers
  stackedData.forEach((layer, i) => {
    svg
      .selectAll(`.arc-${i}`)
      .data(layer)
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("fill", colorScale(speedOrder[i]))
            .attr("stroke", "#fff")
            .attr("d", (d, j) => arcPath(d, j, radiusScale, angleScale))
            .on("mouseover", handleMouseOver)
            .on("mousemove", handleMouseMove)
            .on("mouseout", handleMouseOut),
        (update) =>
          update
            .transition()
            .duration(500)
            .attr("d", (d, j) => arcPath(d, j, radiusScale, angleScale)),
        (exit) => exit.remove()
      );
  });
  // Add radial grid lines
  svg
    .append("g")
    .selectAll("circle")
    .data(radiusScale.ticks(4))
    .join("circle")
    .attr("fill", "none")
    .attr("stroke", "#ccc")
    .attr("r", radiusScale);

  // Add direction labels
  svg
    .append("g")
    .selectAll("text")
    .data(data)
    .join("text")
    .attr("text-anchor", "middle")
    .attr("x", (d) => Math.sin(angleScale(d.direction_bin)) * (radius + 15))
    .attr("y", (d) => -Math.cos(angleScale(d.direction_bin)) * (radius + 15))
    .text((d) => directionLabels[d.direction_bin])
    .style("font-size", "16px");
}

// Function to draw wind rose legend
function drawWindLegend(containerId) {
  const legendContainer = d3.select(containerId);
  legendContainer.html(""); // Clear existing

  const speedOrder = [
    "Light (<10)",
    "Moderate (10-20)",
    "Strong (20-30)",
    "Very Strong (30-40)",
    "Extreme (>40)",
  ];

  const colorScale = d3
    .scaleOrdinal()
    .domain(speedOrder)
    .range(["#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"]);

  speedOrder.forEach((label) => {
    const row = legendContainer.append("div").attr("class", "legend-row");

    row
      .append("div")
      .attr("class", "legend-color")
      .style("background-color", colorScale(label));

    row.append("span").text(label);
  });
}

function startStackedWindRoseAnimation() {
  fetch("/wind_rose/animated")
    .then((res) => res.json())
    .then((data) => {
      windRoseData = data;
      windYears = Object.keys(data["Northern"]).map(Number).sort();
      //console.log("Wind rose years:", windYears);
      windYearIndex = 0;

      drawWindRoseFrame(windYears[windYearIndex]);

      windRoseTimer = setInterval(playNextYear, 2000);
      windRoseIsPlaying = true;

      drawWindLegend("#windRoseLegend");
      initWindControls(windYears); // attach button + slider handlers
    })
    .catch((err) => console.error("Failed to load animated wind rose:", err));
}

// Function to initialize wind rose controls
function setButtonState(isPlaying) {
  const playBtn = document.getElementById("playButton-wind");
  const pauseBtn = document.getElementById("pauseButton-wind");

  playBtn.disabled = isPlaying;
  pauseBtn.disabled = !isPlaying;

  if (isPlaying) {
    pauseBtn.classList.remove("btn-primary");
    pauseBtn.classList.add("btn-outline-primary");
    playBtn.classList.remove("btn-outline-primary");
    playBtn.classList.add("btn-primary");
  } else {
    playBtn.classList.remove("btn-primary");
    playBtn.classList.add("btn-outline-primary");
    pauseBtn.classList.remove("btn-outline-primary");
    pauseBtn.classList.add("btn-primary");
  }
}

function initWindControls(windYears) {
  const playBtn = document.getElementById("playButton-wind");
  const pauseBtn = document.getElementById("pauseButton-wind");
  const slider = document.getElementById("windYearSlider");
  if (slider && windYears.length) {
    slider.min = 0;
    slider.max = windYears.length - 1;
    slider.value = 0;
  }

  setButtonState(true); // autoplay is on initially

  playBtn.addEventListener("click", () => {
    if (!windRoseIsPlaying) {
      windRoseTimer = setInterval(playNextYear, 2000);
      windRoseIsPlaying = true;
      setButtonState(true);
    }
  });

  pauseBtn.addEventListener("click", () => {
    if (windRoseIsPlaying) {
      clearInterval(windRoseTimer);
      windRoseIsPlaying = false;
      setButtonState(false);
    }
  });

  slider.addEventListener("input", (e) => {
    windYearIndex = e.target.value;
    drawWindRoseFrame(windYears[windYearIndex]);
  });
}

function playNextYear() {
  windYearIndex = (windYearIndex + 1) % windYears.length;
  drawWindRoseFrame(windYears[windYearIndex]);
  const slider = document.getElementById("windYearSlider");
  if (slider) {
    slider.value = windYearIndex;
  }
}
function drawWindRoseFrame(year) {
  const containerNorth = "#windRoseNorth";
  const containerSouth = "#windRoseSouth";
  drawWindRose(containerNorth, windRoseData["Northern"][year]);
  drawWindRose(containerSouth, windRoseData["Southern"][year]);
  document.getElementById("windYearDisplay").textContent = `Year: ${year}`;
  document.getElementById("windYearLabel").textContent = `Year: ${year}`;
}

function drawLegend({
  scale,
  label = "Legend",
  containerId = "mapLegend",
  caveat = null,
  useGradient = false,
  tickCount = 5,
  width = 120,
  height = 70,
}) {
  const legendSvg = d3
    .select(`#${containerId}`)
    .html("")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "auto");

  const paddingLeft = 10;
  const boxY = 20;
  const boxHeight = 12;
  const boxWidth = width - paddingLeft * 2;

  if (useGradient) {
    const defs = legendSvg.append("defs");
    const gradientId = "legend-gradient";

    const gradient = defs
      .append("linearGradient")
      .attr("id", gradientId)
      .attr("x1", "0%")
      .attr("x2", "100%")
      .attr("y1", "0%")
      .attr("y2", "0%");

    const domain = scale.domain();

    if (scale.invertExtent) {
      // Quantized-style gradient
      scale.range().forEach((color, i) => {
        const [d0, d1] = scale.invertExtent(color);
        const offset = ((d0 - domain[0]) / (domain[1] - domain[0])) * 100;
        gradient
          .append("stop")
          .attr("offset", `${offset}%`)
          .attr("stop-color", color);
      });
      gradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", scale.range().slice(-1)[0]);
    } else if (scale.interpolator) {
      // Continuous scale
      const steps = 10;
      d3.range(0, 1.01, 1 / steps).forEach((t) => {
        gradient
          .append("stop")
          .attr("offset", `${t * 100}%`)
          .attr("stop-color", scale(t * (domain[1] - domain[0]) + domain[0]));
      });
    }

    legendSvg
      .append("rect")
      .attr("x", paddingLeft)
      .attr("y", boxY)
      .attr("width", boxWidth)
      .attr("height", boxHeight)
      .attr("fill", `url(#${gradientId})`);

    const ticks =
      typeof scale.ticks === "function"
        ? scale.ticks(tickCount)
        : scale.range(); // fallback for quantize/threshold

    const x = d3
      .scaleLinear()
      .domain(domain)
      .range([paddingLeft, paddingLeft + boxWidth]);

    legendSvg
      .selectAll("text.legend-tick")
      .data(ticks)
      .enter()
      .append("text")
      .attr("class", "legend-tick")
      .attr("x", (d) => x(d))
      .attr("y", boxY + boxHeight + 12)
      .attr("text-anchor", "middle")
      .style("font-size", "10px")
      .text((d) => d.toFixed(2));
  } else {
    const legendData = scale.range().map((color, i, arr) => {
      const [d0, d1] = scale.invertExtent(color);
      const label =
        i === arr.length - 1 ? `${d0.toFixed(2)}+` : `${d0.toFixed(2)}`;
      return { color, label };
    });

    const stepWidth = Math.floor(boxWidth / legendData.length);

    legendSvg
      .selectAll("rect")
      .data(legendData)
      .enter()
      .append("rect")
      .attr("x", (d, i) => paddingLeft + i * stepWidth)
      .attr("y", boxY)
      .attr("width", stepWidth)
      .attr("height", boxHeight)
      .attr("fill", (d) => d.color);

    legendSvg
      .selectAll("text.legend-label")
      .data(legendData)
      .enter()
      .append("text")
      .attr("class", "legend-label")
      .attr("x", (d, i) => paddingLeft + i * stepWidth + stepWidth / 2)
      .attr("y", boxY + boxHeight + 12)
      .attr("text-anchor", "middle")
      .style("font-size", "10px")
      .text((d) => d.label);
  }

  legendSvg
    .append("text")
    .attr("x", paddingLeft)
    .attr("y", 12)
    .attr("font-size", "12px")
    .attr("font-weight", "bold")
    .text(label);

  if (caveat) {
    legendSvg
      .append("text")
      .attr("x", paddingLeft)
      .attr("y", height - 5)
      .attr("font-size", "10px")
      .attr("fill", "#555")
      .text(caveat);
  }
}

function drawMap(mode) {
  showLoader(loaders.map);

  // Remove 'active' from all buttons
  document
    .querySelectorAll(".mode-button")
    .forEach((btn) => btn.classList.remove("active"));

  // Add 'active' to the correct button
  const buttonId = `btn${capitalize(mode)}Map`;
  document.getElementById(buttonId)?.classList.add("active");

  // Update map title
  const mapTitle = document.getElementById("mapTitle");
  if (mode === "static") {
    mapTitle.textContent = "Static CO Levels (2014–2024 Average)";
  } else if (mode === "animated") {
    mapTitle.textContent = "Animated CO Evolution (2014–2024)";
  } else if (mode === "correlation") {
    mapTitle.textContent = "CO vs Wind Correlation by State";
  }

  toggleAnimatedControlsVisibility(mode === "animated");
  // Clear previous SVG
  d3.select("#mapVisualizationContainer svg").remove();

  const yearTitle = document.getElementById("yearTitle");
  if (yearTitle) {
    if (mode === "animated") {
      currentIndex = 0;
      currentYearIndex = 0;
      yearTitle.classList.remove("fade-in"); // reset
      void yearTitle.offsetWidth; // trigger reflow
      yearTitle.classList.add("fade-in");
      yearTitle.classList.remove("hidden");
    } else {
      yearTitle.classList.add("hidden");
      yearTitle.classList.remove("fade-in");
      stopYearAnimation();
    }
  }
  const container = document.getElementById("mapVisualizationContainer");
  const bbox = container.getBoundingClientRect();

  const svg = d3
    .select("#mapVisualizationContainer")
    .append("svg")
    .attr("width", bbox.width)
    .attr("height", bbox.height);

  const defs = svg.append("defs");

  defs
    .append("filter")
    .attr("id", "national-outline-shadow")
    .append("feDropShadow")
    .attr("dx", 0)
    .attr("dy", 0)
    .attr("stdDeviation", 0.75)
    .attr("flood-color", "#4a110d")
    .attr("flood-opacity", 0.65);

  projection = d3
    .geoAlbersUsa()
    .scale(bbox.width * 1.2)
    .translate([bbox.width / 2, bbox.height / 2]);

  let drawFn;
  if (mode === "static") {
    drawFn = drawStaticMap;
  } else if (mode === "animated") {
    drawFn = drawAnimatedCOMap;
  } else if (mode === "correlation") {
    drawFn = drawCorrelationMap;
  }

  const dataUrl = WIND_VECTOR_URLS[mode];

  drawFn(svg).then((maybeContext) => {
    if (mode === "animated") {
      updateMapYears();
      startYearAnimation();
    }

    const year = maybeContext?.year || null;

    if (windOverlayActive) {
      toggleWindOverlay({
        svg,
        projection,
        fipsToCentroid,
        dataUrl: WIND_VECTOR_URLS[mode],
        active: true,
        filterYear: year,
      });
    }

    const states = topojson.feature(
      usTopoJSON,
      usTopoJSON.objects.states
    ).features;
    renderStateLabels(svg, states);

    hideLoader(loaders.map);
  });

  currentMapMode = mode;
}

document.getElementById("btnStaticMap").addEventListener("click", () => {
  drawMap("static");
  toggleAnimatedControlsVisibility(false);
});

document.getElementById("btnAnimatedMap").addEventListener("click", () => {
  drawMap("animated");
  toggleAnimatedControlsVisibility(true);
});

document.getElementById("btnCorrelationMap").addEventListener("click", () => {
  drawMap("correlation");
  toggleAnimatedControlsVisibility(false);
});

// Function to draw static map
// This function fetches the US TopoJSON data and draws the map
async function drawStaticMap(svg) {
  showLoader(loaders.map); // for UX
  if (!usTopoJSON) {
    console.error("US TopoJSON not loaded yet!");
    return;
  }

  try {
    const res = await fetch("/choropleth_data");
    const data = await res.json();

    // Build all needed mappings in one go
    const coByFIPS = new Map();
    fipsToMeta.clear(); // optional: in case re-rendering
    fipsToAbbr.clear();
    abbrToFips.clear();

    data.forEach((d) => {
      coByFIPS.set(d.state_fips, d.avg_co);
      fipsToMeta.set(d.state_fips, {
        name: d.state,
        abbr: d.state_code,
        value: d.avg_co,
      });
      fipsToAbbr.set(d.state_fips, d.state_code);
      abbrToFips.set(d.state_code, d.state_fips);
    });

    const colorScale = d3
      .scaleQuantize()
      .domain(d3.extent(data, (d) => d.avg_co))
      .range(d3.schemeReds[9]);

    const states = topojson.feature(
      usTopoJSON,
      usTopoJSON.objects.states
    ).features;

    renderStateLabels(svg, states);

    const path = d3.geoPath().projection(projection);

    svg
      .selectAll("path.state")
      .data(states)
      .join("path")
      .attr("class", "state")
      .attr("d", path)
      .attr("fill", (d) => {
        const val = coByFIPS.get(d.id);
        return val != null ? colorScale(val) : "#ccc";
      })
      .on("mouseover", (event, d) => {
        const fips = d.id;
        const stateMeta = fipsToMeta.get(fips);
        const coVal = coByFIPS.get(fips);
        const abbr = fipsToAbbr.get(fips);
        const wind = getWindByAbbr(abbr, { mode: "static" });

        const html = getCombinedTooltipHTML(stateMeta, coVal, wind, {
          label: "Avg (2014–2024)",
        });

        d3.select("#tooltip").style("visibility", "visible").html(html);
      })

      .on("mousemove", (event) => {
        d3.select("#tooltip")
          .style("top", `${event.pageY - 40}px`)
          .style("left", `${event.pageX + 15}px`);
      })
      .on("mouseout", () => {
        d3.select("#tooltip").style("visibility", "hidden");
      });

    // Borders
    svg
      .append("path")
      .datum(
        topojson.mesh(usTopoJSON, usTopoJSON.objects.states, (a, b) => a !== b)
      )
      .attr("fill", "none")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .attr("class", "state-borders")
      .attr("d", path);

    // National outline
    svg
      .append("path")
      .datum(
        topojson.mesh(usTopoJSON, usTopoJSON.objects.states, (a, b) => a === b)
      )
      .attr("fill", "none")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .attr("class", "national-outline")
      .attr("d", path)
      .attr("filter", "url(#national-outline-shadow)");

    drawLegend({
      scale: colorScale,
      label: "CO (PPM)",
      containerId: "mapLegend",
      useGradient: false,
      width: 280, // shrink from 400 to 280 or less
      height: 60,
      caveat: "* Bin ranges are approximated",
    });
  } catch (err) {
    console.error("Error rendering static map:", err);
  } finally {
    hideLoader(loaders.map);
  }
}

async function drawAnimatedCOMap(svg) {
  showLoader(loaders.map);

  const res = await fetch("/choropleth_data/animated");
  animatedData = await res.json();

  if (!animatedData || !usTopoJSON) {
    console.error("Missing data or US map TopoJSON");
    hideLoader(loaders.map);
    return;
  }

  fipsToAbbr.clear();
  Object.entries(animatedData).forEach(([abbr, entry]) => {
    fipsToAbbr.set(entry.state_fips, abbr);
  });

  const states = topojson.feature(
    usTopoJSON,
    usTopoJSON.objects.states
  ).features;
  renderStateLabels(svg, states);

  // Build color scale from all values across all years
  const allValues = Object.values(animatedData)
    .flatMap((state) => Object.values(state.year || {}))
    .filter((v) => v != null);

  colorScale = d3
    .scaleQuantize()
    .domain(d3.extent(allValues))
    .range(d3.schemeReds[9]);

  const path = d3.geoPath().projection(projection);
  currentYearIndex = 0;
  hoveredStateId = null;

  years = Object.keys(Object.values(animatedData)[0]?.year || {}).sort();
  seasons = Object.keys(Object.values(animatedData)[0]?.season || {}).sort();

  statePaths = svg
    .selectAll("path.state")
    .data(states, (d) => d.id)
    .join("path")
    .attr("class", "state")
    .attr("d", path)
    .attr("fill", (d) => {
      const val = getValue(d.id, years[currentYearIndex]);
      return val != null ? colorScale(val) : "#ccc";
    });

  const tooltip = d3.select("#tooltip");

  statePaths
    .on("mouseover", (event, d) => {
      hoveredStateId = d.id;
      // console.log("Hovered state:", hoveredStateId);
      tooltip.style("visibility", "visible");
      updateTooltip(hoveredStateId);
    })
    .on("mousemove", (event) => {
      tooltip
        .style("top", `${event.pageY - 40}px`)
        .style("left", `${event.pageX + 15}px`);
    })
    .on("mouseout", () => {
      hoveredStateId = null;
      tooltip.style("visibility", "hidden");
    });

  // Borders
  svg
    .append("path")
    .datum(
      topojson.mesh(usTopoJSON, usTopoJSON.objects.states, (a, b) => a !== b)
    )
    .attr("class", "state-borders")
    .attr("fill", "none")
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5)
    .attr("d", path);

  // National outline
  svg
    .append("path")
    .datum(
      topojson.mesh(usTopoJSON, usTopoJSON.objects.states, (a, b) => a === b)
    )
    .attr("class", "national-outline")
    .attr("fill", "none")
    .attr("stroke", "#fff")
    .attr("stroke-width", 2)
    .attr("d", path)
    .attr("filter", "url(#national-outline-shadow)");

  drawLegend({
    scale: colorScale,
    label: "CO (PPM)",
    containerId: "mapLegend",
    useGradient: false,
    width: 280, // shrink from 400 to 280 or less
    height: 60,
    caveat: "* Bin ranges are approximated",
  });

  hideLoader(loaders.map);
  return { year: years[currentYearIndex] };
}

async function drawCorrelationMap(svg) {
  showLoader(loaders.map);

  try {
    const res = await fetch("/co_wind_correlation");
    const data = await res.json();

    // Build correlation lookup
    const correlationByFIPS = new Map(
      data.map((d) => [d.state_fips, d.Correlation])
    );

    const states = topojson.feature(
      usTopoJSON,
      usTopoJSON.objects.states
    ).features;

    renderStateLabels(svg, states);
    const path = d3.geoPath().projection(projection);

    // Dynamic diverging color scale
    const allValues = data.map((d) => d.Correlation);
    const maxAbs = Math.max(
      Math.abs(d3.min(allValues)),
      Math.abs(d3.max(allValues))
    );

    const reversedPiYG = (t) => d3.interpolatePiYG(1 - t);

    const colorScale = d3
      .scaleDiverging()
      .domain([-maxAbs, 0, maxAbs])
      .interpolator(reversedPiYG);

    svg
      .selectAll("path.state")
      .data(states)
      .join("path")
      .attr("class", "state")
      .attr("d", path)
      .attr("fill", (d) => {
        const val = correlationByFIPS.get(d.id);
        return val != null ? colorScale(val) : "#ccc";
      })
      .on("mouseover", (event, d) => {
        const tooltip = d3.select("#tooltip");
        const info = data.find((row) => row.state_fips === d.id);

        if (!info) {
          tooltip
            .style("visibility", "visible")
            .html(`<strong>No data for this state</strong>`);
          return;
        }

        const fips = d.id;
        const abbr = info.state_code;
        const correlation = isFinite(info.Correlation)
          ? `${info.Correlation.toFixed(3)}`
          : "Unavailable";
        const significance =
          info.Significance === "significant"
            ? "✅ Significant"
            : "⚠️ Not Significant";

        const stateMeta = {
          name: info.state,
          abbr: abbr,
        };

        const wind = getWindByAbbr(abbr, { mode: "correlation" });

        const html = `
          <div style="font-weight: bold;">${stateMeta.name} (${abbr})</div>
          <div>Correlation: <span style="color:#5e548e;">${correlation}</span></div>
          <div>${significance}</div>
          ${
            windOverlayActive && wind
              ? `
            <hr style="margin: 4px 0;">
            <div><strong>Wind:</strong></div>
            <div>Speed: ${wind.wind_speed?.toFixed(2) ?? "?"} mph</div>
            <div>Direction: ${degreesToCardinal(
              wind.wind_direction
            )} (${wind.wind_direction?.toFixed(0)}°)</div>
            `
              : ""
          }
        `;

        tooltip.style("visibility", "visible").html(html);
      })

      .on("mousemove", (event) => {
        d3.select("#tooltip")
          .style("top", `${event.pageY - 40}px`)
          .style("left", `${event.pageX + 15}px`);
      })
      .on("mouseout", () => {
        d3.select("#tooltip").style("visibility", "hidden");
      });

    // Borders
    svg
      .append("path")
      .datum(
        topojson.mesh(usTopoJSON, usTopoJSON.objects.states, (a, b) => a !== b)
      )
      .attr("class", "state-borders")
      .attr("fill", "none")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .attr("d", path);

    // Outline
    svg
      .append("path")
      .datum(
        topojson.mesh(usTopoJSON, usTopoJSON.objects.states, (a, b) => a === b)
      )
      .attr("class", "national-outline")
      .attr("fill", "none")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .attr("d", path)
      .attr("filter", "url(#national-outline-shadow)");

    drawLegend({
      scale: colorScale,
      label: "CO–Wind Correlation",
      containerId: "mapLegend",
      useGradient: true,
      width: 280,
      caveat: "* Negative = inverse relationship",
    });
  } catch (err) {
    console.error("Error rendering correlation map:", err);
  } finally {
    hideLoader(loaders.map);
  }
}
