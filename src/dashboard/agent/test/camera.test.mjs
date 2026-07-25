import assert from "node:assert/strict";
import test from "node:test";
import { parseCameraList } from "../dist/camera.js";

test("parses a detected rpicam camera", () => {
  assert.deepEqual(
    parseCameraList("Available cameras\n0 : imx219 [3280x2464] (/base/soc/i2c0mux/i2c@1/imx219@10)"),
    { available: true, model: "imx219" }
  );
});

test("recognizes an empty camera list", () => {
  assert.deepEqual(parseCameraList("No cameras available!"), {
    available: false,
    model: undefined
  });
});
