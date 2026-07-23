import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "/api/detect";

function drawResult(canvas, image, detections) {
  const context = canvas.getContext("2d");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);

  const lineWidth = Math.max(3, Math.round(image.naturalWidth / 500));
  const fontSize = Math.max(16, Math.round(image.naturalWidth / 55));
  context.lineWidth = lineWidth;
  context.strokeStyle = "#ff3d52";
  context.fillStyle = "#ff3d52";
  context.font = `700 ${fontSize}px Inter, sans-serif`;

  detections.forEach(({ box, confidence, class: className }, index) => {
    const width = box.x2 - box.x1;
    const height = box.y2 - box.y1;
    context.strokeRect(box.x1, box.y1, width, height);
    const label = `${className.toUpperCase()} ${Math.round(confidence * 100)}%`;
    const labelWidth = context.measureText(label).width + 12;
    const labelY = Math.max(0, box.y1 - fontSize - 8);
    context.fillRect(box.x1, labelY, labelWidth, fontSize + 8);
    context.fillStyle = "white";
    context.fillText(label, box.x1 + 6, labelY + fontSize + 1);
    context.fillStyle = "#ff3d52";
    context.fillText(String(index + 1), box.x1 + 4, box.y1 + fontSize);
  });
}

export default function App() {
  const [imageUrl, setImageUrl] = useState("");
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const imageRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => () => imageUrl && URL.revokeObjectURL(imageUrl), [imageUrl]);

  function selectFile(nextFile) {
    if (!nextFile?.type.startsWith("image/")) {
      setError("Choose a JPG, PNG, WEBP, or another image file.");
      return;
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setFile(nextFile);
    setImageUrl(URL.createObjectURL(nextFile));
    setResult(null);
    setError("");
  }

  async function detect() {
    if (!file) return;
    setLoading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);

    try {
      const response = await fetch(API_URL, { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Detection failed");
      setResult(data);
      if (imageRef.current.complete) {
        drawResult(canvasRef.current, imageRef.current, data.detections);
      }
    } catch (requestError) {
      setError(requestError.message || "Could not reach the detection API.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl("");
    setFile(null);
    setResult(null);
    setError("");
  }

  return (
    <main>
      <header>
        <div className="eyebrow"><span /> OBJECT VISION</div>
        <h1>Find objects<br />from above.</h1>
        <p>Upload an aerial photo. The configured model will locate objects and draw a box around each one.</p>
      </header>

      <section className="workspace">
        {!imageUrl ? (
          <label
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              selectFile(event.dataTransfer.files[0]);
            }}
          >
            <input type="file" accept="image/*" onChange={(event) => selectFile(event.target.files[0])} />
            <div className="upload-icon">↥</div>
            <strong>Drop an aerial image here</strong>
            <span>or click to browse · maximum 20 MB</span>
          </label>
        ) : (
          <div className="preview">
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Uploaded aerial view"
              onLoad={() => result && drawResult(canvasRef.current, imageRef.current, result.detections)}
            />
            <canvas ref={canvasRef} className={result ? "visible" : ""} />
            {loading && <div className="scanning"><span>SCANNING IMAGE</span></div>}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        {imageUrl && (
          <div className="actions">
            <button className="secondary" onClick={reset} disabled={loading}>Choose another</button>
            <button className="primary" onClick={detect} disabled={loading}>
              {loading ? "Detecting…" : "Detect objects"}
            </button>
          </div>
        )}
      </section>

      {result && (
        <section className={`result ${result.object_present ? "positive" : "clear"}`}>
          <div className="result-mark">{result.object_present ? "✓" : "○"}</div>
          <div>
            <span>DETECTION COMPLETE</span>
            <h2>{result.object_present ? `${result.count} ${result.count === 1 ? "object" : "objects"} detected` : "No objects detected"}</h2>
            <p>{result.object_present ? "Detected objects are marked with red rectangles." : "No detection passed the confidence threshold."}</p>
          </div>
        </section>
      )}
    </main>
  );
}
