# WebRTC camera migration plan

## Goal

Replace the two-second, base64 JPEG `camera.preview` loop with a real-time H.264
stream from each Raspberry Pi 5. Keep encrypted dashboard messaging for camera
health, one-shot photographs, stream control, detector state, bounding boxes,
and pause/resume actions.

## Target architecture

```text
Pi 5 camera
  ├─ rpicam-vid H.264 → FFmpeg RTSP publisher → Ubuntu MediaMTX → WebRTC browser
  ├─ camera.capture JPEG → encrypted Socket.IO response
  └─ detector JPEG/result → Ubuntu detector → encrypted status and box messages
```

Media must not be encoded as base64 or transported through Socket.IO. The
Ubuntu host terminates WebRTC through MediaMTX so the browser has one stable
media endpoint even when Pi addresses change.

## Implementation phases

1. Add validated stream configuration and `camera.stream.start`,
   `camera.stream.stop`, and `camera.stream.status` commands to the Pi agent.
2. Add a single-owner stream controller that launches baseline H.264 with
   `rpicam-vid`, pipes it to FFmpeg, publishes to a device-specific RTSP path,
   reports failures, and reliably terminates both processes.
3. Install a pinned MediaMTX release and systemd service on Ubuntu. Expose RTSP
   publishing on port 8554 and WebRTC playback/signalling on port 8889.
4. Replace the interval-preview checkbox behavior with stream start/stop
   commands and an embedded WebRTC player.
5. Preserve `camera.capture` as a bounded encrypted command. Stop and restore
   the stream around a still capture when exclusive camera access requires it.
6. Preserve the latest detector result and render its normalized rectangles
   above the WebRTC stage. Because libcamera allows a single camera owner,
   detector-frame capture pauses while WebRTC owns the camera and resumes when
   the live stream stops. A later optimization can sample the published RTSP
   stream on Ubuntu without opening the Pi camera a second time.
7. Remove `camera.preview` after the WebRTC path is verified. Retain the last
   captured or detected JPEG as a non-live fallback.

## Configuration

Pi defaults:

```json
{
  "camera_stream": {
    "enabled": true,
    "publish_url": "rtsp://ubuntu-host:8554/pipa1-camera",
    "width": 1280,
    "height": 720,
    "fps": 20,
    "bitrate": 2500000
  }
}
```

Ubuntu publishes the browser base URL from `WEBRTC_PUBLIC_URL`; when omitted,
the web application uses its current hostname with port 8889.

## Lifecycle and failure handling

- Starting is idempotent and never creates duplicate publishers.
- Stopping terminates FFmpeg and `rpicam-vid`, then releases camera resources.
- The UI stops its publisher when the checkbox is cleared or the device page
  unmounts.
- Unexpected publisher exit is shown as an error and can be retried by the
  operator.
- Camera health checks continue while the stream is active.
- A full-resolution photograph temporarily stops and then restores the stream.
- Page visibility does not transport media through the command channel.

## Security

- Publishing URLs remain in Pi deployment configuration and are not returned to
  the browser.
- Device IDs are restricted to safe path characters.
- MediaMTX administrative APIs and unused media protocols remain disabled.
- The first implementation is LAN-scoped and media paths are not independently
  authenticated; host firewall rules must keep ports 8554, 8889, and 8189 off
  untrusted networks.
- A production/remote deployment requires per-device publishing credentials,
  short-lived viewer authorization, TLS, and TURN.

## Acceptance criteria

- Video starts within three seconds on the LAN and normally remains below one
  second of glass-to-glass latency.
- No `camera.preview` base64 frames are sent through Socket.IO.
- Start, stop, retry, disconnect, and page-unmount paths do not leak processes.
- “Take picture” still returns a full-resolution JPEG.
- Detector rectangles scale with the 1280-by-720 stream stage.
- Existing detector state and rectangles remain visible while video is live;
  detector sampling resumes after the stream releases the camera.
- Builds, type checks, unit tests, shell syntax checks, and deployment
  configuration validation pass.
