/*
 * 机の噴水（実物）: Art-Net を受けて、小型ポンプと LED を動かす ESP32 のプログラム。
 * 作り方と配線は docs/desk-build.md。
 *
 * エディタの「書き出し ▾ → Art-Net で送る…」が、会場「机の試作（8台）」の
 * 機材を、ユニバース 1（Art-Net では 0）の番地 1 から 5 チャンネルずつ送る：
 *   +0 ポンプ（水圧 0..255）  +1 R  +2 G  +3 B  +4 明るさ
 * このプログラムは、その値で 1 台ずつ、ポンプを PWM で回し、真下の LED を光らせる。
 *
 * 安全：Art-Net が 1 秒来なければポンプを止める（パソコンが止まっても水が出続けない）。
 *
 * 書き込み：Arduino IDE でボード「ESP32 Dev Module」か「M5Stack-ATOM」、
 * ライブラリは FastLED だけ。secrets.example.h を secrets.h に写して Wi-Fi を書く。
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <FastLED.h>
#include "secrets.h"

// ------------------------------------------------------------ 設定（ここだけ直す）

// 噴水の台数（会場「机の試作（8台）」は 8）
constexpr int NUM_JETS = 8;
// ポンプの MOSFET をつなぐピン（左の噴水から順に）。M5Stack ATOM なら G19 G22 G23 G33 G21 G25 G26 G32 など
const int PUMP_PINS[NUM_JETS] = {19, 22, 23, 33, 21, 25, 26, 32};
// LED（WS2812 / SK6812 のテープ）の信号のピン。1 台に 1 つ、左から順に並べる
constexpr int LED_PIN = 27;
// 受けるユニバース（Art-Net の数え方。エディタのユニバース 1 は 0）と、最初の番地
constexpr uint16_t UNIVERSE = 0;
constexpr int START_ADDRESS = 1;
constexpr int FOOTPRINT = 5;
// ポンプは弱い電圧では回り始めない：0 より上の値は MIN_DUTY..MAX_DUTY に割り当てる（%）
constexpr float MIN_DUTY = 0.35f;
constexpr float MAX_DUTY = 1.00f;
// MOSFET を切り替える速さ（Hz）。20 kHz は耳に聞こえない。モジュールが熱くなるなら 1000 に
constexpr int PWM_FREQ = 20000;
constexpr int PWM_BITS = 10;
// LED の明るさの上限（0..255）。テープは明るいので控えめに
constexpr uint8_t LED_MAX = 160;
// これだけ Art-Net が来なければ止める（ms）
constexpr uint32_t FAILSAFE_MS = 1000;

// ------------------------------------------------------------ ここから下は直さなくてよい

constexpr uint16_t ARTNET_PORT = 6454;
constexpr uint16_t OP_DMX = 0x5000;
WiFiUDP udp;
CRGB leds[NUM_JETS];
uint8_t packet[18 + 512];
uint32_t lastFrame = 0;
bool running = false;

static void pumpWrite(int k, uint8_t v) {
  const int top = (1 << PWM_BITS) - 1;
  int duty = 0;
  if (v > 0) duty = (int)((MIN_DUTY + (MAX_DUTY - MIN_DUTY) * (v / 255.0f)) * top);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(PUMP_PINS[k], duty);
#else
  ledcWrite(k, duty);
#endif
}

static void allOff() {
  for (int k = 0; k < NUM_JETS; k++) pumpWrite(k, 0);
  fill_solid(leds, NUM_JETS, CRGB::Black);
  FastLED.show();
}

/** One Art-Net DMX frame: the jets' five channels each, from START_ADDRESS. */
static void apply(const uint8_t *dmx, int length) {
  for (int k = 0; k < NUM_JETS; k++) {
    const int a = START_ADDRESS - 1 + k * FOOTPRINT;
    if (a + FOOTPRINT > length) break;
    pumpWrite(k, dmx[a]);
    const uint16_t level = (uint16_t)dmx[a + 4] * LED_MAX / 255;
    leds[k] = CRGB((dmx[a + 1] * level) / 255, (dmx[a + 2] * level) / 255, (dmx[a + 3] * level) / 255);
  }
  FastLED.show();
}

void setup() {
  Serial.begin(115200);
  for (int k = 0; k < NUM_JETS; k++) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(PUMP_PINS[k], PWM_FREQ, PWM_BITS);
#else
    ledcSetup(k, PWM_FREQ, PWM_BITS);
    ledcAttachPin(PUMP_PINS[k], k);
#endif
  }
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_JETS);
  allOff();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // a sleeping radio drops frames
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print('.');
  }
  // this address goes in the editor's 「Art-Net で送る…」 (送り先)
  Serial.printf("\nArt-Net の送り先：%s（ポート %u、ユニバース %u）\n", WiFi.localIP().toString().c_str(), ARTNET_PORT, UNIVERSE);
  udp.begin(ARTNET_PORT);
}

void loop() {
  const int n = udp.parsePacket();
  if (n > 0) {
    const int len = udp.read(packet, sizeof(packet));
    // "Art-Net\0", OpDmx (little-endian), the universe (SubUni, Net), the length (big-endian), the data
    if (len >= 18 && memcmp(packet, "Art-Net", 8) == 0 && (packet[8] | packet[9] << 8) == OP_DMX) {
      const uint16_t universe = packet[14] | (packet[15] << 8);
      const int length = min((packet[16] << 8) | packet[17], len - 18);
      if (universe == UNIVERSE) {
        apply(packet + 18, length);
        lastFrame = millis();
        if (!running) Serial.println("受信を始めました");
        running = true;
      }
    }
  }
  if (running && millis() - lastFrame > FAILSAFE_MS) {
    allOff();
    running = false;
    Serial.println("Art-Net が止まったので、ポンプを止めました");
  }
}
