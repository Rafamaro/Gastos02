import { chooseDataDirectory, getSavedDirectory, isFsAccessSupported, readJsonFile, writeJsonFile } from "./storage/fsAccess.js";

const USERS_FILE = "users.json";
const PBKDF2_ITERATIONS = 150000;

function ensureCrypto(){
  if(typeof crypto === "undefined" || !crypto.subtle) throw new Error("El navegador no soporta WebCrypto.");
}

function toBase64(bytes){
  let out = "";
  for(let i = 0; i < bytes.length; i += 0x8000){
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

function fromBase64(value){
  const bin = atob(String(value || ""));
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function normalizeUsername(value){ return String(value || "").trim().toLowerCase(); }
function slug(value){ return String(value || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, ""); }

async function deriveBits(password, salt){
  ensureCrypto();
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, keyMaterial, 256);
}

async function hashPassword(password, salt){
  const bits = await deriveBits(password, salt);
  return toBase64(new Uint8Array(bits));
}

async function loadUsers(rootHandle){
  const payload = await readJsonFile(rootHandle, USERS_FILE);
  if(payload && Array.isArray(payload.users)) return payload;
  const empty = { version: 1, users: [] };
  await writeJsonFile(rootHandle, USERS_FILE, empty);
  return empty;
}

async function saveUsers(rootHandle, payload){
  await writeJsonFile(rootHandle, USERS_FILE, payload);
}

async function verifyPassword(password, record){
  const salt = fromBase64(record.salt);
  const digest = await hashPassword(password, salt);
  return digest === record.hash;
}

function buildAuthOverlay(hasRoot){
  const root = document.createElement("div");
  root.className = "auth-overlay";
  root.innerHTML = `
    <div class="auth-card">
      <h2>Ingreso seguro</h2>
      <p class="muted">Seleccioná o creá tu usuario. Cada usuario guarda datos en su propia carpeta.</p>
      <button id="authChooseFolder" type="button" class="btn" style="display:${hasRoot ? "none" : "block"}">Elegir carpeta de datos</button>
      <div class="auth-tabs" style="display:${hasRoot ? "flex" : "none"}">
        <button type="button" class="btn small" data-auth-tab="login">Ingresar</button>
        <button type="button" class="btn small" data-auth-tab="register">Crear usuario</button>
      </div>

      <form id="authLoginForm" class="auth-form" style="display:${hasRoot ? "grid" : "none"}">
        <label>Usuario</label>
        <input id="authLoginUser" autocomplete="username" required />
        <label>Contraseña</label>
        <input id="authLoginPass" type="password" autocomplete="current-password" required />
        <button class="btn" type="submit">Entrar</button>
      </form>

      <form id="authRegisterForm" class="auth-form" style="display:none">
        <label>Nuevo usuario</label>
        <input id="authRegUser" autocomplete="username" required />
        <label>Contraseña</label>
        <input id="authRegPass" type="password" autocomplete="new-password" minlength="4" required />
        <button class="btn" type="submit">Crear y entrar</button>
      </form>
      <div id="authError" class="muted" style="color:var(--danger)"></div>
    </div>`;

  return root;
}

function switchTab(overlay, tab){
  const login = overlay.querySelector("#authLoginForm");
  const register = overlay.querySelector("#authRegisterForm");
  login.style.display = tab === "login" ? "grid" : "none";
  register.style.display = tab === "register" ? "grid" : "none";
}

export async function ensureAuthenticatedSession(){
  if(!isFsAccessSupported()) return { mode: "manual", dataDirHandle: null, user: null };

  let rootHandle = await getSavedDirectory();
  let usersPayload = rootHandle ? await loadUsers(rootHandle) : { version: 1, users: [] };
  const appRoot = document.getElementById("app");
  if(appRoot) appRoot.style.display = "none";

  return new Promise((resolve, reject)=>{
    const overlay = buildAuthOverlay(Boolean(rootHandle));
    document.body.appendChild(overlay);

    const errorEl = overlay.querySelector("#authError");
    const setError = (msg)=>{ errorEl.textContent = msg || ""; };

    const loginForm = overlay.querySelector("#authLoginForm");
    const registerForm = overlay.querySelector("#authRegisterForm");
    const tabs = overlay.querySelector('.auth-tabs');
    const chooseBtn = overlay.querySelector('#authChooseFolder');

    const finish = async (userRecord)=>{
      try{
        const userDir = await rootHandle.getDirectoryHandle(userRecord.folder, { create: true });
        if(appRoot) appRoot.style.display = "";
        overlay.remove();
        resolve({ mode: "local-folder", dataDirHandle: userDir, user: userRecord.username });
      }catch(err){ reject(err); }
    };

    const enableAuthForms = ()=>{
      chooseBtn.style.display = 'none';
      tabs.style.display = 'flex';
      switchTab(overlay, usersPayload.users.length === 0 ? 'register' : 'login');
    };

    chooseBtn.addEventListener('click', async ()=>{
      try{
        rootHandle = await chooseDataDirectory();
        usersPayload = await loadUsers(rootHandle);
        enableAuthForms();
      }catch(err){
        setError(err?.message || 'No se pudo seleccionar carpeta');
      }
    });

    overlay.querySelectorAll("[data-auth-tab]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        setError("");
        switchTab(overlay, btn.dataset.authTab);
      });
    });

    loginForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      setError("");
      const username = normalizeUsername(overlay.querySelector("#authLoginUser").value);
      const password = overlay.querySelector("#authLoginPass").value;
      const record = usersPayload.users.find(u => u.usernameNorm === username);
      if(!record){ setError("Usuario no encontrado."); return; }
      if(!(await verifyPassword(password, record))){ setError("Contraseña incorrecta."); return; }
      await finish(record);
    });

    registerForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      setError("");
      const usernameRaw = overlay.querySelector("#authRegUser").value;
      const password = overlay.querySelector("#authRegPass").value;
      const username = normalizeUsername(usernameRaw);
      if(username.length < 3){ setError("El usuario debe tener al menos 3 caracteres."); return; }
      if(password.length < 4){ setError("La contraseña debe tener al menos 4 caracteres."); return; }
      if(usersPayload.users.some(u => u.usernameNorm === username)){ setError("Ese usuario ya existe."); return; }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const record = {
        username: String(usernameRaw || "").trim(),
        usernameNorm: username,
        salt: toBase64(salt),
        hash: await hashPassword(password, salt),
        folder: `user-${slug(username) || `u-${Date.now()}`}`,
        createdAt: new Date().toISOString()
      };

      usersPayload.users.push(record);
      await saveUsers(rootHandle, usersPayload);
      await finish(record);
    });

    if(rootHandle) enableAuthForms();
  });
}
