
"use strict";

// Phase 1: interface only.
// Motor commands remain disabled until MQTT is configured.

const status = document.querySelector("#status");
const detail = document.querySelector("#detail");

document.querySelectorAll("[data-drive], [data-steer]").forEach((button) => {
  button.addEventListener("click", () => {
    status.textContent = "Not connected";
    detail.textContent = "Cloud connection not configured";
  });
});

document.querySelector("#stop").addEventListener("click", () => {
  status.textContent = "Not connected";
  detail.textContent = "Cloud connection not configured";
});
