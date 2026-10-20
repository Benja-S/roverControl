#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <PubSubClient.h>
#include <cstring>
#include "secrets.h"

// ==================== MOTOR PINS ====================
// L298N ENA and ENB jumpers should remain installed.
const uint8_t DRIVE_IN1 = D1;
const uint8_t DRIVE_IN2 = D2;
const uint8_t STEER_IN1 = D5;
const uint8_t STEER_IN2 = D6;

// ==================== HIVEMQ CLOUD ====================
const char* MQTT_HOST =
    "706d9facdf63418b9eb215dcb67a829d.s1.eu.hivemq.cloud";

const uint16_t MQTT_PORT = 8883;

const char* CONTROL_TOPIC = "rover/control";
const char* STATUS_TOPIC  = "rover/status";

BearSSL::WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);

// ==================== TIMING ====================
const unsigned long DRIVE_TIMEOUT_MS = 500;
const unsigned long STEER_PULSE_MS = 200;
const unsigned long MQTT_RETRY_MS = 3000;

unsigned long lastDriveCommand = 0;
unsigned long steerStopAt = 0;
unsigned long lastMqttAttempt = 0;

bool driveActive = false;
bool steeringActive = false;

// ==================== MOTOR FUNCTIONS ====================
void stopDrive() {
    digitalWrite(DRIVE_IN1, LOW);
    digitalWrite(DRIVE_IN2, LOW);
    driveActive = false;
}

void stopSteering() {
    digitalWrite(STEER_IN1, LOW);
    digitalWrite(STEER_IN2, LOW);
    steeringActive = false;
}

void stopAll() {
    stopDrive();
    stopSteering();
}

// ==================== MQTT STATUS ====================
void publishStatus(const char* message) {
    if (mqtt.connected()) {
        mqtt.publish(STATUS_TOPIC, message);
    }
}

// ==================== COMMAND HANDLER ====================
void handleCommand(char* topic, byte* payload, unsigned int length) {
    if (strcmp(topic, CONTROL_TOPIC) != 0) {
        return;
    }

    char command[24];

    if (length == 0 || length >= sizeof(command)) {
        return;
    }

    memcpy(command, payload, length);
    command[length] = '\0';

    Serial.print("Received command: ");
    Serial.println(command);

    if (strcmp(command, "forward") == 0) {
        digitalWrite(DRIVE_IN1, HIGH);
        digitalWrite(DRIVE_IN2, LOW);

        driveActive = true;
        lastDriveCommand = millis();
    }
    else if (strcmp(command, "reverse") == 0) {
        digitalWrite(DRIVE_IN1, LOW);
        digitalWrite(DRIVE_IN2, HIGH);

        driveActive = true;
        lastDriveCommand = millis();
    }
    else if (strcmp(command, "stop") == 0) {
        stopAll();
    }
    else if (strcmp(command, "left") == 0) {
        if (!steeringActive) {
            digitalWrite(STEER_IN1, HIGH);
            digitalWrite(STEER_IN2, LOW);

            steeringActive = true;
            steerStopAt = millis() + STEER_PULSE_MS;
        }
    }
    else if (strcmp(command, "right") == 0) {
        if (!steeringActive) {
            digitalWrite(STEER_IN1, LOW);
            digitalWrite(STEER_IN2, HIGH);

            steeringActive = true;
            steerStopAt = millis() + STEER_PULSE_MS;
        }
    }
}

// ==================== MQTT CONNECTION ====================
bool connectMqtt() {
    if (mqtt.connected()) {
        return true;
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Wi-Fi is disconnected.");
        return false;
    }

    // Diagnostic only: never print the credentials themselves.
    Serial.println();
    Serial.println("Attempting HiveMQ connection...");

    Serial.print("MQTT host: ");
    Serial.println(MQTT_HOST);

    Serial.print("MQTT port: ");
    Serial.println(MQTT_PORT);

    Serial.print("MQTT username length: ");
    Serial.println(strlen(MQTT_USERNAME));

    Serial.print("MQTT password length: ");
    Serial.println(strlen(MQTT_PASSWORD));

    Serial.print("Wi-Fi IP: ");
    Serial.println(WiFi.localIP());

    stopAll();

    String clientId = "rover-" + String(ESP.getChipId(), HEX);

    bool connected = mqtt.connect(
        clientId.c_str(),
        MQTT_USERNAME,
        MQTT_PASSWORD
    );

    if (connected) {
        Serial.println("MQTT CONNECTED!");

        if (mqtt.subscribe(CONTROL_TOPIC)) {
            Serial.print("Subscribed to: ");
            Serial.println(CONTROL_TOPIC);
        } else {
            Serial.println("WARNING: MQTT subscription failed.");
        }

        publishStatus("online");
        return true;
    }

    Serial.print("MQTT connection failed, state=");
    Serial.println(mqtt.state());

    switch (mqtt.state()) {
        case -4:
            Serial.println("Reason: MQTT connection timed out.");
            break;

        case -3:
            Serial.println("Reason: MQTT connection lost.");
            break;

        case -2:
            Serial.println("Reason: Network connection failed.");
            break;

        case -1:
            Serial.println("Reason: MQTT client disconnected.");
            break;

        case 1:
            Serial.println("Reason: MQTT protocol version rejected.");
            break;

        case 2:
            Serial.println("Reason: MQTT client ID rejected.");
            break;

        case 3:
            Serial.println("Reason: MQTT server unavailable.");
            break;

        case 4:
            Serial.println("Reason: Bad MQTT username or password.");
            break;

        case 5:
            Serial.println("Reason: MQTT client not authorized.");
            break;

        default:
            Serial.println("Reason: See PubSubClient connection state.");
            break;
    }

    return false;
}

// ==================== SETUP ====================
void setup() {
    pinMode(DRIVE_IN1, OUTPUT);
    pinMode(DRIVE_IN2, OUTPUT);
    pinMode(STEER_IN1, OUTPUT);
    pinMode(STEER_IN2, OUTPUT);

    stopAll();

    Serial.begin(115200);
    delay(300);

    Serial.println();
    Serial.println("============================");
    Serial.println("RC ROVER STARTING");
    Serial.println("============================");

    // Verify that the secret macros are present.
    Serial.print("Wi-Fi SSID length: ");
    Serial.println(strlen(WIFI_SSID));

    Serial.print("MQTT username length: ");
    Serial.println(strlen(MQTT_USERNAME));

    Serial.print("MQTT password length: ");
    Serial.println(strlen(MQTT_PASSWORD));

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.print("Connecting to Wi-Fi");

    while (WiFi.status() != WL_CONNECTED) {
        stopAll();
        delay(250);
        Serial.print(".");

        // No motor commands are accepted before MQTT connects.
    }

    Serial.println();
    Serial.println("Wi-Fi connected!");

    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());

    // Encrypted connection for initial testing.
    // This does not validate the broker's certificate.
    // Replace with certificate validation before relying on
    // this connection for security-sensitive use.
    secureClient.setInsecure();

    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(handleCommand);
    mqtt.setKeepAlive(20);
    mqtt.setSocketTimeout(5);
    mqtt.setBufferSize(256);

    Serial.println("HiveMQ client configured.");
    Serial.println("============================");
}

// ==================== MAIN LOOP ====================
void loop() {
    if (WiFi.status() != WL_CONNECTED) {
        stopAll();

        // Attempt to recover Wi-Fi without rebooting.
        WiFi.reconnect();

        delay(100);
        return;
    }

    if (!mqtt.connected()) {
        stopAll();

        if (millis() - lastMqttAttempt >= MQTT_RETRY_MS) {
            lastMqttAttempt = millis();
            connectMqtt();
        }

        delay(10);
        return;
    }

    mqtt.loop();

    // Stop drive if browser heartbeat/commands stop arriving.
    if (driveActive &&
        millis() - lastDriveCommand > DRIVE_TIMEOUT_MS) {
        stopDrive();
    }

    // Steering motor only receives a short pulse.
    if (steeringActive &&
        (long)(millis() - steerStopAt) >= 0) {
        stopSteering();
    }
}