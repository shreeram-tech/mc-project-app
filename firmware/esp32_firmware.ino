#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// --- Configuration ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "http://YOUR_PC_IP:5000/api/data"; // Replace with your PC's IP

const int MOISTURE_PIN = 34; // Analog pin for Capacitive Soil Moisture Sensor
const int RELAY_PIN = 26;    // Digital pin for Relay Module

// Calibration values (Adjust based on your sensor)
const int AIR_VALUE = 3500;   // Value when sensor is in air (0% moisture)
const int WATER_VALUE = 1500; // Value when sensor is in water (100% moisture)

unsigned long lastTime = 0;
unsigned long timerDelay = 2000; // Send data every 2 seconds

void setup() {
  Serial.begin(115200);
  
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // Assume Active LOW relay (HIGH = OFF)

  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.println("Connecting to WiFi");
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.print("Connected to WiFi network with IP Address: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  // Send data periodically
  if ((millis() - lastTime) > timerDelay) {
    if(WiFi.status() == WL_CONNECTED){
      WiFiClient client;
      HTTPClient http;

      // Read Moisture
      int sensorValue = analogRead(MOISTURE_PIN);
      // Map value to percentage (0-100)
      // Note: Capacitive sensors usually have higher value for dry, lower for wet
      int percent = map(sensorValue, AIR_VALUE, WATER_VALUE, 0, 100);
      percent = constrain(percent, 0, 100);

      // Create JSON payload
      StaticJsonDocument<200> doc;
      doc["moisture"] = percent;
      String requestBody;
      serializeJson(doc, requestBody);

      // Send POST request
      http.begin(client, serverUrl);
      http.addHeader("Content-Type", "application/json");
      
      int httpResponseCode = http.POST(requestBody);

      if (httpResponseCode > 0) {
        String response = http.getString();
        Serial.println(httpResponseCode);
        Serial.println(response);

        // Parse response to control motor
        StaticJsonDocument<200> responseDoc;
        DeserializationError error = deserializeJson(responseDoc, response);

        if (!error) {
          bool motorStatus = responseDoc["motor_command"];
          // Control Relay (Active LOW logic: LOW is ON, HIGH is OFF)
          if (motorStatus) {
            digitalWrite(RELAY_PIN, LOW); 
            Serial.println("Motor ON");
          } else {
            digitalWrite(RELAY_PIN, HIGH);
            Serial.println("Motor OFF");
          }
        }
      }
      else {
        Serial.print("Error on sending POST: ");
        Serial.println(httpResponseCode);
      }
      http.end();
    }
    else {
      Serial.println("WiFi Disconnected");
    }
    lastTime = millis();
  }
}
