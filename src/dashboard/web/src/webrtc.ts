function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const handleChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      peer.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", handleChange);
  });
}

export class WhepVideoSession {
  readonly #peer = new RTCPeerConnection();
  readonly #token: string;
  readonly #url: string;
  #sessionUrl: string | undefined;

  constructor(url: string, token: string) {
    this.#url = url;
    this.#token = token;
  }

  async connect(video: HTMLVideoElement, onDisconnected: () => void): Promise<void> {
    this.#peer.addTransceiver("video", { direction: "recvonly" });
    this.#peer.addEventListener("track", (event) => {
      video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void video.play().catch(() => undefined);
    });
    this.#peer.addEventListener("connectionstatechange", () => {
      if (["failed", "disconnected", "closed"].includes(this.#peer.connectionState)) {
        onDisconnected();
      }
    });
    const offer = await this.#peer.createOffer();
    await this.#peer.setLocalDescription(offer);
    await waitForIceGathering(this.#peer);
    const response = await fetch(this.#url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Content-Type": "application/sdp"
      },
      body: this.#peer.localDescription?.sdp
    });
    if (!response.ok) throw new Error(`Secure WebRTC handshake failed (HTTP ${response.status})`);
    const location = response.headers.get("Location");
    if (location) this.#sessionUrl = new URL(location, this.#url).toString();
    await this.#peer.setRemoteDescription({
      type: "answer",
      sdp: await response.text()
    });
  }

  close() {
    this.#peer.close();
    if (this.#sessionUrl) {
      void fetch(this.#sessionUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.#token}` }
      }).catch(() => undefined);
    }
  }
}
