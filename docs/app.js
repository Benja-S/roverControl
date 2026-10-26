
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
let generation = 0;

// Every control currently held (buttons and keys): "forward", "reverse",
// "left", "right". Drive and steering are independent, so any mix can be held.
const pressed = new Set();
const SEND_INTERVAL_MS = 100; // must stay well under the ESP's 500 ms timeout

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

  const wasMoving = pressed.size > 0;
  pressed.clear();

  if (sendStop && wasMoving) {
    publish("stop");
  }
}

// Publishes both axes in one message: "<drive>,<steer>", each -1, 0 or 1.
// Drive: 1 forward, -1 reverse. Steer: 1 right, -1 left.
function sendState() {
  if (!connected()) {
    stopDrive(false);
    return;
  }

  const drive = (pressed.has("forward") ? 1 : 0) - (pressed.has("reverse") ? 1 : 0);
  const steer = (pressed.has("right") ? 1 : 0) - (pressed.has("left") ? 1 : 0);
  publish(`${drive},${steer}`);
}

function setPressed(command, isDown) {
  if (isDown) {
    if (!connected()) {
      setStatus("Not connected", "Connect to HiveMQ first.", "error");
      return;
    }

    pressed.add(command);
  } else if (!pressed.delete(command)) {
    return; // it was not held, nothing to do
  }

  if (pressed.size === 0) {
    stopDrive(false);
    publish("stop");
    return;
  }

  sendState(); // react immediately, then keep refreshing while held
  if (driveHeartbeat === null) {
    driveHeartbeat = setInterval(sendState, SEND_INTERVAL_MS);
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

// Drive and steering buttons: press and hold. Each button tracks its own
// pointer, so two fingers (drive + steer) work at the same time.
document.querySelectorAll("[data-drive], [data-steer]").forEach((button) => {
  const command = button.dataset.drive || button.dataset.steer;
  if (!["forward", "reverse", "left", "right"].includes(command)) return;

  const release = (event) => {
    event.preventDefault();
    setPressed(command, false);
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    setPressed(command, true);
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
});

// Keyboard: arrows or WASD (several keys at once work), Space = stop.
const KEY_COMMANDS = {
  ArrowUp: "forward", w: "forward",
  ArrowDown: "reverse", s: "reverse",
  ArrowLeft: "left", a: "left",
  ArrowRight: "right", d: "right"
};

function keyCommand(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return KEY_COMMANDS[key];
}

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea")) return; // typing credentials

  if (event.key === " ") {
    event.preventDefault();
    stopAll();
    return;
  }

  const command = keyCommand(event);
  if (!command) return;

  event.preventDefault();
  if (!event.repeat) setPressed(command, true);
});

document.addEventListener("keyup", (event) => {
  const command = keyCommand(event);
  if (command) setPressed(command, false);
});

// If the tab is hidden or the window loses focus, stop sending drive commands
// (also clears keys whose keyup we will never see).
window.addEventListener("blur", () => stopDrive(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopDrive(true);
});

stopBtn.addEventListener("click", stopAll);

disconnectBtn.addEventListener("click", disconnect);

window.addEventListener("beforeunload", () => {
  stopDrive(false);
  if (client) client.end(true);
});

setStatus("Not connected", "Enter your MQTT credentials and connect.");
