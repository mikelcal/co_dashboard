// === loaderUtils.js ===

// Show loader by ID
function showLoader(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
  else console.warn(`Loader element with ID '${id}' not found.`);
}

// Hide loader by ID
function hideLoader(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
  else console.warn(`Loader element with ID '${id}' not found.`);
}

export { showLoader, hideLoader };
