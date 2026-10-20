
"use strict";

const BROKER_HOST =
  "706d9facdf63418b9eb215dcb67a829d.s1.eu.hivemq.cloud";
const BROKER_URL = `wss://${BROKER_HOST}:8884/mqtt`;

const CONTROL_TOPIC = "rover/control";
const STATUS_TOPIC = "rover/status";

const statusEl = document.querySelector("#status");
const detailEl = document.querySelector("#detail");
const indicator = document.querySelector("#status-indicator");
const form = document.querySelector("#connection-form");
const userEl = document.querySelector("#mqtt-user");
const passEl = document.querySelector("#mqtt-pass");
const connectBtn = document.querySelector("#connect");
const disconnectBtn = document.querySelector("#disconnect");
const stopBtn = document.querySelector("#stop");

let client = null;
let driveHeartbeat = null;
let activeDrive = null;
let generation = 0;

function setStatus(status, detail, kind = "") {
  statusEl.textContent = status;
  detailEl.textContent = detail;
  indicator.className = "indicator";

  if (kind) indicator.classList.add(kind);
}

function connected() {
  return Boolean(client && client.connected);
}

function publish(command) {
  if (!connected()) {
    setStatus("Not connected", "Connect to HiveMQ before moving.", "error");
    return false;
  }

  client.publish(CONTROL_TOPIC, command, { qos: 0 }, (err) => {
    if (err) {
      setStatus("Publish failed", "Check your MQTT permissions.", "error");
    }
  });

  return true;
}

function stopDrive(sendStop = true) {
  if (driveHeartbeat !== null) {
    clearInterval(driveHeartbeat);
    driveHeartbeat = null;
  }

  const wasDriving = activeDrive !== null;
  activeDrive = null;

  if (sendStop && wasDriving) {
    publish("stop");
  }
}

function stopAll() {
  stopDrive(false);
  publish("stop");
}

function disconnect() {
  generation++;
  stopDrive(false);

  const oldClient = client;
  client = null;

  if (oldClient) {
    if (oldClient.connected) {
      oldClient.publish(CONTROL_TOPIC, "stop");
    }
    oldClient.end(true);
  }

  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  setStatus("Disconnected", "Connection closed.", "");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (typeof mqtt === "undefined") {
    setStatus(
      "MQTT library unavailable",
      "Check your internet connection and reload the page.",
      "error"
    );
    return;
  }

  const username = userEl.value.trim();
  const password = passEl.value;

  if (!username || !password) {
    setStatus("Credentials required", "Enter your MQTT username and password.", "error");
    return;
  }

  disconnect();
  const myGeneration = ++generation;

  connectBtn.disabled = true;
  setStatus("Connecting", "Opening secure WebSocket connection...");

  const newClient = mqtt.connect(BROKER_URL, {
    username,
    password,
    clientId: "rover_web_" + Math.random().toString(16).slice(2, 10),
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 3000,
    keepalive: 15
  });

  client = newClient;

  newClient.on("connect", () => {
    if (myGeneration !== generation) return;

    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    setStatus("Connected to HiveMQ", "Checking rover status...", "connected");

    newClient.subscribe(STATUS_TOPIC, { qos: 0 }, (err) => {
      if (err && myGeneration === generation) {
        setStatus(
          "Connected, status unavailable",
          "Check subscribe permission for rover/status.",
          "error"
        );
      }
    });
  });

  newClient.on("message", (topic, payload) => {
    if (myGeneration !== generation) return;

    if (topic === STATUS_TOPIC) {
      setStatus(
        "Connected to HiveMQ",
        "Rover status: " + payload.toString(),
        "connected"
      );
    }
  });

  newClient.on("reconnect", () => {
    if (myGeneration !== generation) return;

    stopDrive(false);
    setStatus("Reconnecting", "Movement disabled while reconnecting.");
  });

  newClient.on("offline", () => {
    if (myGeneration !== generation) return;

    stopDrive(false);
    setStatus("Offline", "Broker connection lost.", "error");
  });

  newClient.on("error", (err) => {
    if (myGeneration !== generation) return;

    setStatus("Connection error", err.message, "error");
  });

  newClient.on("close", () => {
    if (myGeneration !== generation) return;

    stopDrive(false);
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    setStatus("Disconnected", "Check internet, credentials, and broker permissions.", "error");
  });
});

// Drive controls: press and hold. Refresh before the ESP's 500 ms timeout.
document.querySelectorAll("[data-drive]").forEach((button) => {
  const start = (event) => {
    event.preventDefault();

    if (!connected()) {
      setStatus("Not connected", "Connect to HiveMQ first.", "error");
      return;
    }

    const command = button.dataset.drive;
    if (!["forward", "reverse"].includes(command)) return;

    stopDrive(false);
    activeDrive = command;

    if (!publish(command)) {
      activeDrive = null;
      return;
    }

    driveHeartbeat = setInterval(() => {
      if (!connected() || activeDrive !== command) {
        stopDrive(false);
        return;
      }

      publish(command);
    }, 200);
  };

  const end = (event) => {
    if (event) event.preventDefault();
    if (activeDrive === button.dataset.drive) stopDrive(true);
  };

  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("lostpointercapture", end);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
});

// If the tab is hidden or the window loses focus, stop sending drive commands.
window.addEventListener("blur", () => stopDrive(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopDrive(true);
});

// Steering sends one brief command. The ESP8266 enforces the pulse duration.
document.querySelectorAll("[data-steer]").forEach((button) => {
  button.addEventListener("click", () => {
    const command = button.dataset.steer;

    if (!connected()) {
      setStatus("Not connected", "Connect to HiveMQ first.", "error");
      return;
    }

    if (["left", "right"].includes(command)) {
      publish(command);
    }
  });
});

stopBtn.addEventListener("click", stopAll);

disconnectBtn.addEventListener("click", disconnect);

window.addEventListener("beforeunload", () => {
  stopDrive(false);
  if (client) client.end(true);
});

setStatus("Not connected", "Enter your MQTT credentials and connect.");
