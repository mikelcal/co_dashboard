let hoveredWindElement = null;
let windArrowSelection = null;
const windDataCache = new Map(); // Cache to store wind data

// Global Choropleth map variables
const WIND_VECTOR_URLS = {
  static: "/wind_vectors/static",
  animated: "/wind_vectors/animated",
  seasonal: "/wind_vectors/seasonal",
  correlation: "/wind_vectors/static",
};

// Utility function
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

async function useWindData(url) {
  if (windDataCache.has(url)) {
    return windDataCache.get(url);
  }

  try {
    const res = await fetch(url);
    const data = await res.json();

    // Flat array (static, correlation)
    if (Array.isArray(data)) {
      const byState = {};
      data.forEach((d) => {
        const key = d.state_code;
        if (key) byState[key] = d;
      });
      const result = { byState };
      windDataCache.set(url, result);
      return result;
    }

    // Year-keyed or nested year-season keyed (animated, seasonal)
    if (typeof data === "object" && data !== null) {
      const isSeasonalNested = Object.values(data)?.[0]?.Spring != null;

      if (isSeasonalNested) {
        // Structure: { "2014": { Spring: { GA: {...}, ... } } }
        windDataCache.set(url, data);
        return data;
      } else {
        // Structure: { "2014": [ {...}, {...} ] }
        windDataCache.set(url, data);
        return data;
      }
    }

    throw new Error("Unsupported wind data format.");
  } catch (err) {
    console.error("Failed to load wind data:", err);
    return {};
  }
}

function getWindByAbbr(
  abbr,
  { mode = "static", year = null, season = null } = {}
) {
  const url = WIND_VECTOR_URLS[mode];
  const cache = windDataCache.get(url);
  if (!cache || !abbr) return null;

  if (mode === "static" || mode === "correlation") {
    return cache.byState?.[abbr] ?? null;
  }

  if (mode === "animated") {
    return cache[year]?.find((d) => d.state_code === abbr) ?? null;
  }

  if (mode === "seasonal") {
    return cache[year]?.[season]?.[abbr] ?? null;
  }

  return null;
}

// Normalize the three wind payload shapes — flat {byState}, year-keyed
// arrays ({ "2014": [...] }), and year→season-keyed objects
// ({ "2014": { Spring: { GA: {...} } } }) — into a flat array of records,
// applying year/season filters when given.
function selectWindRecords(result, { filterYear = null, filterSeason = null } = {}) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (result.byState) return Object.values(result.byState);

  const yearKeys = Object.keys(result).sort();
  if (!yearKeys.length) return [];

  const yearData = result[String(filterYear ?? yearKeys[0])];
  if (Array.isArray(yearData)) return yearData;

  if (yearData && typeof yearData === "object") {
    if (filterSeason && yearData[filterSeason]) {
      return Object.values(yearData[filterSeason]);
    }
    // No season requested: fall back to the first season present
    const firstSeason = Object.keys(yearData)[0];
    return firstSeason ? Object.values(yearData[firstSeason]) : [];
  }

  return [];
}

async function toggleWindOverlay({
  svg,
  projection,
  fipsToCentroid,
  dataUrl,
  active = false,
  arrowScale = 0.75,
  trailLayers = 4,
  filterYear = null,
  filterSeason = null,
}) {
  if (!svg || svg.empty()) {
    console.warn("SVG not found for wind overlay.");
    return;
  }

  if (!fipsToCentroid || typeof fipsToCentroid.get !== "function") {
    console.warn("Missing or invalid fipsToCentroid map");
    return;
  }

  if (!active) {
    removeWindVectors(svg);
    return;
  }

  try {
    const result = await useWindData(dataUrl);
    const data = selectWindRecords(result, { filterYear, filterSeason });

    drawWindTrails(svg, data, {
      projection,
      fipsToCentroid,
      arrowScale,
      trailLayers,
    });

    // Tooltip events now handled on state paths only — no more .wind-arrow bindings
  } catch (err) {
    console.error("Failed to toggle wind overlay:", err);
  }
}

async function loadWindData(mode) {
  const url = WIND_VECTOR_URLS[mode];
  return await useWindData(url); // returns { byState }
}

function removeWindVectors(svg) {
  svg.selectAll("g.wind-trails").remove();

  // Clear any lingering wind tooltip content
  const tooltip = d3.select("#tooltip");
  tooltip.select(".wind-info").remove();

  if (tooltip.html().trim() === "") {
    tooltip.style("visibility", "hidden");
  }
}

const windReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Wind speed (now mph after the unit fix) → arrow length in px. A scale keeps
// this robust to the data's range instead of a raw multiplier tuned to the old
// tenths-of-m/s magnitudes.
const windLengthScale = d3.scaleLinear().domain([0, 20]).range([8, 48]).clamp(true);

function arrowHeadPath(len) {
  const w = 5; // half-width of the head
  const tip = -len;
  return `M ${-w} ${tip + w * 1.6} L 0 ${tip} L ${w} ${tip + w * 1.6} Z`;
}

function attachWindTooltip(selection, windTooltipId) {
  selection
    .on("mouseover", function (event, d) {
      const tooltip = d3.select(`#${windTooltipId}`);
      const existingHTML = tooltip.html() || "";
      if (!existingHTML.includes("Wind:")) {
        const deg = d.wind_direction;
        const dir = degreesToCardinal(deg);
        tooltip.html(
          existingHTML +
            `
            <div class="wind-info">
              <hr style="margin: 4px 0;">
              <strong>Wind:</strong><br>
              Speed: ${d.wind_speed.toFixed(1)} mph<br>
              From: ${dir} (${Math.round(deg)}°)
            </div>
          `
        );
      }
      tooltip.style("visibility", "visible");
    })
    .on("mousemove", (event) => {
      d3.select(`#${windTooltipId}`)
        .style("top", `${event.pageY - 40}px`)
        .style("left", `${event.pageX + 15}px`);
    })
    .on("mouseout", () => {
      d3.select(`#${windTooltipId}`).style("visibility", "hidden");
    });
}

// Draw one persistent arrow per state and transition its rotation/length
// between years, so direction change over time is actually visible. Arrows
// point in the direction the wind flows *to* (wind_direction is the
// meteorological "from" bearing, hence the +180).
function drawWindTrails(
  svg,
  data,
  {
    projection,
    fipsToCentroid,
    windTooltipId = "tooltip",
    animationDuration = 1500,
  } = {}
) {
  if (!svg || svg.empty()) return;
  if (!fipsToCentroid || typeof fipsToCentroid.get !== "function") {
    console.error("Missing or invalid fipsToCentroid map");
    return;
  }

  const records = (data || []).filter(
    (d) =>
      d &&
      d.wind_direction != null &&
      d.wind_speed != null &&
      fipsToCentroid.get(d.state_fips)
  );

  const arrowTransform = (d) => {
    const [cx, cy] = projection(fipsToCentroid.get(d.state_fips));
    return `translate(${cx},${cy}) rotate(${(d.wind_direction || 0) + 180})`;
  };

  // Keep the container group across updates instead of tearing it down each frame
  let g = svg.select("g.wind-trails");
  if (g.empty()) g = svg.append("g").attr("class", "wind-trails");

  const groups = g
    .selectAll("g.wind-arrow")
    .data(records, (d) => d.state_fips)
    .join(
      (enter) => {
        const grp = enter
          .append("g")
          .attr("class", "wind-arrow")
          .attr("transform", arrowTransform);
        grp
          .append("line")
          .attr("x1", 0)
          .attr("y1", 0)
          .attr("x2", 0)
          .attr("y2", (d) => -windLengthScale(d.wind_speed))
          .attr("stroke", "#00f0ff")
          .attr("stroke-width", 2.5)
          .attr("stroke-linecap", "round");
        grp
          .append("path")
          .attr("fill", "#00f0ff")
          .attr("d", (d) => arrowHeadPath(windLengthScale(d.wind_speed)));
        attachWindTooltip(grp, windTooltipId);
        return grp;
      },
      (update) => update,
      (exit) => exit.remove()
    );

  const animate = (sel) =>
    windReducedMotion
      ? sel
      : sel.transition().duration(animationDuration).ease(d3.easeCubicInOut);

  animate(groups).attr("transform", arrowTransform);
  animate(groups.select("line")).attr("y2", (d) => -windLengthScale(d.wind_speed));
  animate(groups.select("path")).attr("d", (d) =>
    arrowHeadPath(windLengthScale(d.wind_speed))
  );
}

export {
  toggleWindOverlay,
  removeWindVectors,
  drawWindTrails,
  selectWindRecords,
  useWindData,
  loadWindData,
  getWindByAbbr,
  windDataCache,
};
