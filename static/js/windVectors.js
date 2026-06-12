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
const windLengthScale = d3.scaleLinear().domain([0, 20]).range([7, 40]).clamp(true);

// Muted teal with a white casing/halo. Pure neon cyan (#00f0ff) on the red CO
// choropleth was near-complementary and vibrated harshly; a desaturated teal
// plus a neutral white outline removes the buzz and keeps the arrow legible
// across the whole ramp (light salmon → dark red). Teal stays distinguishable
// for red/green color-blind viewers.
const WIND_ARROW_COLOR = "#1fa6b8";
const WIND_ARROW_CASING = "rgba(255, 255, 255, 0.9)";

// Custom wavy-arrow glyph (viewBox 0 0 10 20, drawn pointing DOWN with the tip
// at the bottom). One closed path with fill-rule:evenodd. We orient/size it per
// arrow via a transform: translate to center on x=5, then scale(s, -s) to flip
// it so it points UP (north) at rotation 0 and size it to the wind speed. The
// casing uses a non-scaling stroke so its thickness stays constant at any scale.
const WIND_ARROW_GLYPH_D =
  "M4.24.35c.36-.42.99-.47,1.41-.11,1.59,1.36,2.37,2.69,2.42,4.08.04,1.34-.61,2.48-1.22,3.41-.15.23-.3.45-.45.67-1.14,1.69-2.01,2.97-1.23,4.86.38.92.82,2.05.83,3.28l2.28-2.35.72.7.72.7-4,4.12c-.19.19-.45.3-.72.3s-.53-.11-.72-.3L.28,15.57l.72-.7.72-.7,2.28,2.35c0-.78-.3-1.58-.68-2.52-1.2-2.95.34-5.18,1.46-6.79.14-.21.28-.4.4-.59.6-.91.92-1.59.9-2.24-.02-.6-.35-1.45-1.72-2.63-.42-.36-.47-.99-.11-1.41ZM1,14.87l.72-.7c-.38-.4-1.02-.41-1.41-.02-.4.38-.41,1.02-.02,1.41l.72-.7ZM9,14.87l.72.7c.38-.4.37-1.03-.02-1.41-.4-.38-1.03-.37-1.41.02l.72.7Z";

// Wind speed → per-arrow glyph transform. The glyph is 20 units tall, so a
// scale of px/20 makes it `px` long; the negative y flips it to point up.
function glyphScaleTransform(d) {
  const s = windLengthScale(d.wind_speed) / 20;
  return `scale(${s}, ${-s}) translate(-5, 0)`;
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
        // Single wavy-arrow glyph: teal fill with a constant-width white casing.
        grp
          .append("path")
          .attr("class", "wind-arrow-shape")
          .attr("d", WIND_ARROW_GLYPH_D)
          .attr("fill-rule", "evenodd")
          .attr("fill", WIND_ARROW_COLOR)
          .attr("stroke", WIND_ARROW_CASING)
          .attr("stroke-width", 2)
          .attr("stroke-linejoin", "round")
          .attr("vector-effect", "non-scaling-stroke")
          .style("paint-order", "stroke")
          // Stagger the breathing pulse so arrows shimmer instead of blinking in
          // unison (the pulse itself is a CSS opacity animation, see main.css).
          .style("animation-delay", (d, i) => `${(i % 8) * 0.18}s`)
          .attr("transform", glyphScaleTransform);
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
  animate(groups.select("path")).attr("transform", glyphScaleTransform);
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
  degreesToCardinal,
  WIND_VECTOR_URLS,
};
