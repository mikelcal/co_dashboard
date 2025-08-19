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

async function toggleWindOverlay({
  svg,
  projection,
  fipsToCentroid,
  dataUrl,
  active = false,
  arrowScale = 0.75,
  trailLayers = 4,
  filterYear = null,
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
    const data = Array.isArray(result)
      ? result
      : result.byState
      ? Object.values(result.byState)
      : []; // fallback if structured

    drawWindTrails(svg, data, {
      projection,
      fipsToCentroid,
      arrowScale,
      trailLayers,
      filterYear,
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

// Function to draw animated wind trails (spikes) using D3 transitions
function drawWindTrails(
  svg,
  data,
  {
    projection,
    fipsToCentroid,
    windTooltipId = "tooltip",
    trailLayers = 4,
    arrowScale = 2,
    animationDuration = 2000,
  } = {}
) {
  if (!svg || svg.empty()) return;
  if (!fipsToCentroid || typeof fipsToCentroid.get !== "function") {
    console.error("Missing or invalid fipsToCentroid map");
    return;
  }

  // Remove existing trails
  svg.selectAll("g.wind-trails").remove();

  // Create new container group
  const g = svg.append("g").attr("class", "wind-trails");
  const tooltip = d3.select(`#${windTooltipId}`);

  data.forEach((d) => {
    const centroid = fipsToCentroid.get(d.state_fips);
    if (!centroid) return;

    const [lon, lat] = centroid;
    const [cx, cy] = projection([lon, lat]);
    const angle = d.wind_direction;
    const length = d.wind_speed * arrowScale;

    // Create group for all trail segments of a single arrow
    const group = g
      .append("g")
      .attr("transform", `translate(${cx},${cy}) rotate(${angle})`)
      .attr("class", "wind-arrow")
      .on("mouseover", (event) => {
        const tooltip = d3.select("#tooltip");
        const existingHTML = tooltip.html() || "";
        const deg = d.wind_direction;
        const dir = degreesToCardinal(deg);

        // Don’t add twice
        const alreadyHasWind = existingHTML.includes("Wind:");

        if (!alreadyHasWind) {
          const windInfo = `
            <div class="wind-info">
              <hr style="margin: 4px 0;">
              <strong>Wind:</strong><br>
              Speed: ${d.wind_speed.toFixed(1)} mph<br>
              Direction: ${dir} (${Math.round(deg)}°)
            </div>
          `;
          tooltip.html(existingHTML + windInfo);
        }

        tooltip.style("visibility", "visible");
      })
      .on("mousemove", (event) => {
        d3.select("#tooltip")
          .style("top", `${event.pageY - 40}px`)
          .style("left", `${event.pageX + 15}px`);
      })
      .on("mouseout", () => {
        d3.select("#tooltip").style("visibility", "hidden");
      });

    // Add trail segments (reversed: brightest at tip)
    for (let i = 0; i < trailLayers; i++) {
      const lineLength = (length * (i + 1)) / trailLayers;
      const opacity = ((i + 1) / trailLayers) * 0.8; // fade out
      const delay = (i * animationDuration) / trailLayers;

      group
        .append("line")
        .attr("class", "wind-arrow")
        .attr("x1", 0)
        .attr("y1", 0)
        .attr("x2", 0)
        .attr("y2", -lineLength)
        .attr("stroke", "#00f0ff")
        .attr("stroke-width", 2.5)
        .attr("stroke-linecap", "round")
        .style("opacity", 0)
        .transition()
        .delay(delay)
        .duration(animationDuration)
        .ease(d3.easeLinear)
        .style("opacity", opacity)
        .on("end", function repeat() {
          d3.select(this)
            .style("opacity", 0)
            .transition()
            .delay(delay)
            .duration(animationDuration)
            .ease(d3.easeLinear)
            .style("opacity", opacity)
            .on("end", repeat);
        });
    }
  });
}

export {
  toggleWindOverlay,
  removeWindVectors,
  drawWindTrails,
  useWindData,
  loadWindData,
  getWindByAbbr,
  windDataCache,
};
