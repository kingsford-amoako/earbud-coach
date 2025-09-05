const connectBtn = document.getElementById('connect');
const pttBtn = document.getElementById('ptt');
const shortBtn = document.getElementById('short');
const starBtn = document.getElementById('star');
const statusEl = document.getElementById('status');

let pc, micStream, dataChannel;

async function connect() {
  statusEl.textContent = 'initializing…';

  // 1) Ask server for a short-lived session token
  const sess = await fetch('/api/session').then(r => r.json());
  const clientToken = sess?.client_secret?.value;
  if (!clientToken) { alert('No client token from server'); return; }

  // 2) WebRTC setup
  pc = new RTCPeerConnection();
  pc.ondatachannel = (e) => {
  const ch = e.channel;
  ch.onmessage = (m) => {
    try { console.log('model event:', JSON.parse(m.data)); }
    catch { console.log('model event:', m.data); }
  };
};

  // Play incoming audio from the model
  pc.ontrack = e => {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = e.streams[0];
    document.body.appendChild(audio);
  };

  // Optional data channel: send cues like "Short version"
  dataChannel = pc.createDataChannel('oai-events');
  dataChannel.onopen = () => console.log('data channel open');

  // 3) Mic permission
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Start with mic muted (PTT model)
  micStream.getAudioTracks().forEach(t => { t.enabled = false; pc.addTrack(t, micStream); });

  // 4) Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // 5) Send SDP directly to OpenAI Realtime endpoint
  const baseUrl = 'https://api.openai.com/v1/realtime';
  const model = 'gpt-4o-realtime-preview-2025-06-03';
  const resp = await fetch(`${baseUrl}?model=${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clientToken}`,
      'Content-Type': 'application/sdp'
    },
    body: offer.sdp
  });

  const answerSDP = await resp.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSDP });

  statusEl.textContent = 'connected — hold Push-to-Talk when you want it to listen';
  connectBtn.disabled = true;
  pttBtn.disabled = shortBtn.disabled = starBtn.disabled = false;
}

connectBtn.onclick = connect;

// Push-to-Talk toggles your mic track.
// Hold while the interviewer speaks; release while you shadow the model.
let pressed = false;
pttBtn.onmousedown = () => setPTT(true);
pttBtn.onmouseup = () => setPTT(false);
pttBtn.onmouseleave = () => setPTT(false);
pttBtn.ontouchstart = e => { e.preventDefault(); setPTT(true); };
pttBtn.ontouchend = () => setPTT(false);

function setPTT(down) {
  // Toggle mic track
  micStream.getAudioTracks().forEach(t => t.enabled = down);
  pttBtn.textContent = down ? 'Release to stop' : 'Push-to-Talk';

  // When the user releases PTT, ask the model to respond
  if (!down) requestResponse();
}


// Quick cues to reshape output
shortBtn.onclick = () => sendCue('Short version');
starBtn.onclick  = () => sendCue('STAR version');

function sendCue(text) {
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  dataChannel.send(JSON.stringify({ type: 'user.cue', text }));
}

function requestResponse() {
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  // Ask the model to generate a spoken reply, using what it just heard.
  dataChannel.send(JSON.stringify({
    type: "response.create",
    response: {
      modalities: ["audio"],   // speak back
      instructions: ""         // optional extra instruction per turn
    }
  }));
}
