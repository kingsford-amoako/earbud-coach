const unlockBtn  = document.getElementById('unlock');
const connectBtn = document.getElementById('connect');
const pttBtn     = document.getElementById('ptt');
const respondBtn = document.getElementById('respond');
const shortBtn   = document.getElementById('short');
const starBtn    = document.getElementById('star');
const statusEl   = document.getElementById('status');
const logEl      = document.getElementById('log');

let pc, micStream, dataChannel;
let audioUnlocked = false;

function log(...args){ console.log(...args); logEl.textContent += args.join(' ') + '\n'; }

// ---- 0) Explicit audio unlock (beats autoplay blockers) ----
unlockBtn.onclick = async () => {
  try {
    // Create a short silent buffer & play it to unlock autoplay
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, ctx.sampleRate/10, ctx.sampleRate);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    await new Promise(r => setTimeout(r, 120));
    await ctx.close();
    audioUnlocked = true;
    unlockBtn.disabled = true;
    connectBtn.disabled = false;
    statusEl.textContent = 'audio unlocked — ready to connect';
    log('Audio unlocked.');
  } catch (e){ log('Audio unlock failed:', e); }
};

// ---- 1) Connect flow ----
connectBtn.onclick = connect;
async function connect() {
  try {
    statusEl.textContent = 'initializing…';

    // 1) Get ephemeral client token from your server
    const sess = await fetch('/api/session').then(r => r.json());
    const clientToken = sess?.client_secret?.value;
    if (!clientToken) throw new Error('No client token. Open /api/session in a tab to debug.');

    // 2) RTCPeerConnection with STUN
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    pc.oniceconnectionstatechange = () => log('ICE state:', pc.iceConnectionState);
    pc.onconnectionstatechange = () => log('PC state:', pc.connectionState);

    // 3) Add a receiver for model audio (CRITICAL)
    pc.addTransceiver('audio', { direction: 'recvonly' });

    // 4) Play incoming audio
    pc.ontrack = (e) => {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.srcObject = e.streams[0];
      document.body.appendChild(audio);
      const tryPlay = () => audio.play().catch(err => log('Autoplay blocked, click anywhere:', err));
      if (audioUnlocked) tryPlay(); else document.body.addEventListener('click', tryPlay, { once: true });
      log('Incoming audio track attached.');
    };

    // 5) Data channel for control events
    dataChannel = pc.createDataChannel('oai-events');
    dataChannel.onopen = () => log('data channel open');
    dataChannel.onmessage = (m) => { try { log('model event:', JSON.parse(m.data)); } catch { log('model event:', m.data); } };

    // 6) Mic permission; start disabled (Push-to-Talk will enable)
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const micTrack = micStream.getAudioTracks()[0];
    micTrack.enabled = false;
    pc.addTrack(micTrack, micStream);

    // 7) Create offer and WAIT for ICE gathering
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    // 8) Send SDP offer to OpenAI Realtime
    const baseUrl = 'https://api.openai.com/v1/realtime';
    const model   = 'gpt-4o-realtime-preview-2025-06-03';
    const resp = await fetch(`${baseUrl}?model=${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}`, 'Content-Type': 'application/sdp' },
      body: pc.localDescription.sdp
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Realtime SDP POST failed: ${resp.status} ${errText}`);
    }

    const answerSDP = await resp.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSDP });

    statusEl.textContent = 'connected — hold Push-to-Talk while question is asked; release to hear answer';
    connectBtn.disabled = true;
    pttBtn.disabled = respondBtn.disabled = shortBtn.disabled = starBtn.disabled = false;
    log('Connected. Ready.');
  } catch (e){ log('Connect error:', e); statusEl.textContent = 'error — see log below'; }
}

function waitForIceGatheringComplete(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve(true);
    const check = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); resolve(true); } };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(() => resolve(true), 2000); // safety timeout
  });
}

// ---- 2) Push-to-Talk + response trigger ----
pttBtn.onmousedown  = () => setPTT(true);
pttBtn.onmouseup    = () => setPTT(false);
pttBtn.onmouseleave = () => setPTT(false);
pttBtn.ontouchstart = e => { e.preventDefault(); setPTT(true); };
pttBtn.ontouchend   = () => setPTT(false);

function setPTT(down) {
  if (!micStream) return;
  micStream.getAudioTracks().forEach(t => t.enabled = down);
  pttBtn.textContent = down ? 'Release to stop' : 'Push-to-Talk';
  if (!down) requestResponse(); // when released, ask model to answer
}

// Manual “Respond” button (handy for debugging)
respondBtn.onclick = () => requestResponse();

function requestResponse() {
  if (!dataChannel || dataChannel.readyState !== 'open') { log('data channel not open'); return; }
  const payload = {
    type: "response.create",
    response: {
      modalities: ["audio"],         // ask for spoken answer
      instructions: ""               // optional per-turn instruction
    }
  };
  dataChannel.send(JSON.stringify(payload));
  log('response.create sent');
}

// ---- 3) Optional cues ----
shortBtn.onclick = () => sendCue('Short version');
starBtn.onclick  = () => sendCue('STAR version');

function sendCue(text) {
  if (!dataChannel || dataChannel.readyState !== 'open') { log('data channel not open for cue'); return; }
  dataChannel.send(JSON.stringify({ type: 'user.cue', text }));
  log('cue sent:', text);
}
