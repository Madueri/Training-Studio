/**
 * InterpLing — Authentication Module
 * Integrates Supabase Auth for user authentication.
 * Handles: signup, signin, signout, token refresh, auth state management.
 * All API requests automatically include the Authorization header when logged in.
 */

// ── Supabase Client Configuration ───────────────────────────────────────────────
const SUPABASE_URL = "https://ubkgcnurzopqyvrryfzx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8Y-7N4D367nESxjyqNmZyQ_7e6YmRMZ";

// ── Auth State ────────────────────────────────────────────────────────────────
let supabaseClient = null;
let currentUser = null;
let accessToken = null;
let refreshToken = null;

// ── Initialize Supabase Client ─────────────────────────────────────────────────
function initSupabase() {
  if (supabaseClient) return supabaseClient;

  // Load Supabase from CDN if not already loaded
  if (typeof supabase === "undefined") {
    console.warn("[Auth] Supabase JS client not loaded. Add to index.html: <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'></script>");
    return null;
  }

  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  // Listen for auth state changes
  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log("[Auth] State changed:", event, session ? "session present" : "no session");
    if (session) {
      accessToken = session.access_token;
      refreshToken = session.refresh_token;
      currentUser = session.user;
      localStorage.setItem("sb_access_token", accessToken);
      localStorage.setItem("sb_refresh_token", refreshToken);
    } else {
      accessToken = null;
      refreshToken = null;
      currentUser = null;
      localStorage.removeItem("sb_access_token");
      localStorage.removeItem("sb_refresh_token");
    }
    updateAuthUI();
  });

  // Try to restore session from localStorage on page load
  restoreSession();

  return supabaseClient;
}

// ── Restore Session ─────────────────────────────────────────────────────────────
async function restoreSession() {
  const savedToken = localStorage.getItem("sb_access_token");
  const savedRefresh = localStorage.getItem("sb_refresh_token");

  if (!savedToken || !supabaseClient) return;

  try {
    // Set the session from localStorage
    const { data, error } = await supabaseClient.auth.setSession({
      access_token: savedToken,
      refresh_token: savedRefresh,
    });

    if (error) {
      console.warn("[Auth] Session restore failed:", error.message);
      localStorage.removeItem("sb_access_token");
      localStorage.removeItem("sb_refresh_token");
      return;
    }

    if (data.session) {
      accessToken = data.session.access_token;
      refreshToken = data.session.refresh_token;
      currentUser = data.session.user;
      console.log("[Auth] Session restored for user:", currentUser.email);
      updateAuthUI();
    }
  } catch (e) {
    console.warn("[Auth] Session restore error:", e);
  }
}

// ── Sign Up ─────────────────────────────────────────────────────────────────────
async function signUp(email, password, fullName) {
  if (!supabaseClient) {
    return { error: "Supabase client not initialized" };
  }

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (error) return { error: error.message };

    // If session is returned, user is auto-signed in — set tokens immediately
    if (data.session) {
      accessToken = data.session.access_token;
      refreshToken = data.session.refresh_token;
      currentUser = data.user;
      localStorage.setItem("sb_access_token", accessToken);
      localStorage.setItem("sb_refresh_token", refreshToken);
      updateAuthUI();
    }

    return {
      success: true,
      user: data.user,
      message: data.session
        ? "Account created successfully!"
        : "Check your email to confirm your account.",
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Sign In ─────────────────────────────────────────────────────────────────────
async function signIn(email, password) {
  if (!supabaseClient) {
    return { error: "Supabase client not initialized" };
  }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) return { error: error.message };

    accessToken = data.session.access_token;
    refreshToken = data.session.refresh_token;
    currentUser = data.user;
    localStorage.setItem("sb_access_token", accessToken);
    localStorage.setItem("sb_refresh_token", refreshToken);

    updateAuthUI();
    return { success: true, user: data.user };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Sign Out ────────────────────────────────────────────────────────────────────
async function signOut() {
  if (!supabaseClient) {
    localStorage.removeItem("sb_access_token");
    localStorage.removeItem("sb_refresh_token");
    currentUser = null;
    accessToken = null;
    refreshToken = null;
    updateAuthUI();
    return { success: true };
  }

  try {
    await supabaseClient.auth.signOut();
    localStorage.removeItem("sb_access_token");
    localStorage.removeItem("sb_refresh_token");
    currentUser = null;
    accessToken = null;
    refreshToken = null;
    updateAuthUI();
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Refresh Token ─────────────────────────────────────────────────────────────────
async function refreshAccessToken() {
  if (!supabaseClient || !refreshToken) return false;

  try {
    const { data, error } = await supabaseClient.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) return false;

    accessToken = data.session.access_token;
    refreshToken = data.session.refresh_token;
    localStorage.setItem("sb_access_token", accessToken);
    localStorage.setItem("sb_refresh_token", refreshToken);
    return true;
  } catch (e) {
    return false;
  }
}

// ── Get Current User ────────────────────────────────────────────────────────────
function getCurrentUser() {
  return currentUser;
}

function getAccessToken() {
  return accessToken;
}

function isAuthenticated() {
  return !!accessToken && !!currentUser;
}

// ── Auth-Aware Fetch ────────────────────────────────────────────────────────────
/**
 * Wrapper around fetch() that automatically adds the Authorization header
 * when the user is authenticated. Falls back to regular fetch when not logged in.
 */
async function authFetch(url, options = {}) {
  const token = getAccessToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // If 401, try to refresh token once and retry
  if (response.status === 401 && token) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers["Authorization"] = `Bearer ${getAccessToken()}`;
      return fetch(url, { ...options, headers });
    }
  }

  return response;
}

// ── Auth UI Updates ─────────────────────────────────────────────────────────────
/**
 * Update the UI based on authentication state.
 * Shows/hides login/logout elements, updates user display.
 * Sets body[data-authenticated] for CSS-based modal hiding.
 */
function updateAuthUI() {
  const loginBtn = document.getElementById("auth-login-btn");
  const signupBtn = document.getElementById("auth-signup-btn");
  const profileWrap = document.getElementById("snav-profile-wrap");
  const profileInitial = document.getElementById("profile-initial");
  const profileEmail = document.getElementById("profile-dd-email");
  const authModal = document.getElementById("auth-modal");

  if (isAuthenticated()) {
    // Set body attribute for CSS-based modal suppression
    document.body.setAttribute("data-authenticated", "true");

    if (loginBtn) loginBtn.style.display = "none";
    if (signupBtn) signupBtn.style.display = "none";
    if (profileWrap) profileWrap.style.display = "block";
    if (profileInitial) {
      const name = currentUser?.email || "User";
      profileInitial.textContent = name.charAt(0).toUpperCase();
    }
    if (profileEmail) {
      profileEmail.textContent = currentUser?.email || "User";
    }
    // Force-hide modal via JS + CSS class + body attribute (triple safety)
    if (authModal) {
      authModal.style.display = "none";
      authModal.classList.add("auth-modal-hidden");
    }
    console.log("[Auth] User authenticated — profile shown, modal hidden");
  } else {
    document.body.removeAttribute("data-authenticated");

    if (loginBtn) loginBtn.style.display = "inline-block";
    if (signupBtn) signupBtn.style.display = "inline-block";
    if (profileWrap) profileWrap.style.display = "none";
    if (authModal) authModal.classList.remove("auth-modal-hidden");
    console.log("[Auth] User not authenticated — login UI shown");
  }
}

// ── Show Auth Modal ─────────────────────────────────────────────────────────────
function showAuthModal(mode = "signin") {
  let modal = document.getElementById("auth-modal");
  if (!modal) {
    modal = createAuthModal();
  }
  modal.style.display = "flex";
  setAuthMode(mode);
}

function hideAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.style.display = "none";
}

function setAuthMode(mode) {
  const signinForm = document.getElementById("auth-signin-form");
  const signupForm = document.getElementById("auth-signup-form");
  const title = document.getElementById("auth-modal-title");
  const toggle = document.getElementById("auth-toggle-link");

  if (mode === "signin") {
    if (signinForm) signinForm.style.display = "block";
    if (signupForm) signupForm.style.display = "none";
    if (title) title.textContent = "Sign In";
    if (toggle) toggle.innerHTML = 'Don\'t have an account? <a href="#" onclick="setAuthMode(\'signup\'); return false;">Sign Up</a>';
  } else {
    if (signinForm) signinForm.style.display = "none";
    if (signupForm) signupForm.style.display = "block";
    if (title) title.textContent = "Sign Up";
    if (toggle) toggle.innerHTML = 'Already have an account? <a href="#" onclick="setAuthMode(\'signin\'); return false;">Sign In</a>';
  }
}

// ── Create Auth Modal (if not in DOM) ───────────────────────────────────────────
function createAuthModal() {
  const modal = document.createElement("div");
  modal.id = "auth-modal";
  modal.innerHTML = `
    <div class="auth-modal-overlay" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:9999; display:flex; align-items:center; justify-content:center;">
      <div class="auth-modal-content" style="background:var(--bg-primary); border-radius:12px; padding:32px; width:90%; max-width:400px; box-shadow:0 8px 32px rgba(0,0,0,0.3);">
        <h2 id="auth-modal-title" style="margin-bottom:20px; color:var(--text-primary);">Sign In</h2>
        
        <form id="auth-signin-form" onsubmit="handleSignIn(event)">
          <input type="email" id="auth-signin-email" placeholder="Email" required
            style="width:100%; padding:12px; margin-bottom:12px; border-radius:6px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary);" />
          <input type="password" id="auth-signin-password" placeholder="Password" required
            style="width:100%; padding:12px; margin-bottom:16px; border-radius:6px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary);" />
          <button type="submit" class="btn-primary" style="width:100%; padding:12px;">Sign In</button>
        </form>
        
        <form id="auth-signup-form" onsubmit="handleSignUp(event)" style="display:none;">
          <input type="text" id="auth-signup-name" placeholder="Full Name" required
            style="width:100%; padding:12px; margin-bottom:12px; border-radius:6px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary);" />
          <input type="email" id="auth-signup-email" placeholder="Email" required
            style="width:100%; padding:12px; margin-bottom:12px; border-radius:6px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary);" />
          <input type="password" id="auth-signup-password" placeholder="Password (min 6 chars)" required minlength="6"
            style="width:100%; padding:12px; margin-bottom:16px; border-radius:6px; border:1px solid var(--border); background:var(--bg-secondary); color:var(--text-primary);" />
          <button type="submit" class="btn-primary" style="width:100%; padding:12px;">Sign Up</button>
        </form>
        
        <p id="auth-toggle-link" style="text-align:center; margin-top:16px; font-size:14px;">
          Don't have an account? <a href="#" onclick="setAuthMode('signup'); return false;">Sign Up</a>
        </p>
        <p id="auth-error" style="color:#ff4444; text-align:center; margin-top:8px; font-size:13px; display:none;"></p>
        <button onclick="hideAuthModal()" style="position:absolute; top:16px; right:16px; background:none; border:none; font-size:20px; cursor:pointer; color:var(--text-muted);">×</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

// ── Form Handlers ───────────────────────────────────────────────────────────────
async function handleSignIn(event) {
  event.preventDefault();
  const email = document.getElementById("auth-signin-email").value;
  const password = document.getElementById("auth-signin-password").value;
  const errorEl = document.getElementById("auth-error");

  const result = await signIn(email, password);
  if (result.error) {
    errorEl.textContent = result.error;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
    hideAuthModal();
    updateAuthUI(); // Ensure UI updates immediately
    // Force-hide modal again after a short delay (safety)
    setTimeout(() => hideAuthModal(), 100);
    setTimeout(() => hideAuthModal(), 500);

    // If user hasn't completed onboarding, show it (e.g. after email confirmation)
    if (!localStorage.getItem('il_onboarded')) {
      obStep = 0;
      setTimeout(() => {
        const ov = document.getElementById('ob-overlay');
        if (ov) {
          ov.style.display = 'flex';
          document.querySelectorAll('.ob-step').forEach((s, i) => s.classList.toggle('active', i === 0));
          document.querySelectorAll('.ob-prog-dot').forEach((d, i) => d.classList.toggle('active', i <= 0));
          console.log('[Onboarding] Wizard shown on sign-in (not yet onboarded)');
        }
      }, 50);
    }

    // Don't reload — let the auth state change naturally
    // window.location.reload();
  }
}

async function handleSignUp(event) {
  event.preventDefault();
  const name = document.getElementById("auth-signup-name").value;
  const email = document.getElementById("auth-signup-email").value;
  const password = document.getElementById("auth-signup-password").value;
  const errorEl = document.getElementById("auth-error");

  const result = await signUp(email, password, name);
  if (result.error) {
    errorEl.textContent = result.error;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
    if (result.message && result.message.includes("Check your email")) {
      errorEl.textContent = result.message;
      errorEl.style.color = "#4CAF50";
      errorEl.style.display = "block";
    } else {
      hideAuthModal();
      updateAuthUI(); // Ensure UI updates immediately
      // Force-hide modal again after short delays (safety)
      setTimeout(() => hideAuthModal(), 100);
      setTimeout(() => hideAuthModal(), 500);

      // Trigger onboarding for new users — always show on signup, then mark as onboarded after completion
      localStorage.removeItem('il_onboarded');
      localStorage.removeItem('il_path');
      localStorage.removeItem('il_ob_answers');
      localStorage.removeItem('mad_onboarding_category');
      obStep = 0;
      // Defer to next tick so any async auth-state callbacks have settled
      setTimeout(() => {
        const ov = document.getElementById('ob-overlay');
        if (ov) {
          ov.style.display = 'flex';
          document.querySelectorAll('.ob-step').forEach((s, i) => s.classList.toggle('active', i === 0));
          document.querySelectorAll('.ob-prog-dot').forEach((d, i) => d.classList.toggle('active', i <= 0));
          console.log('[Onboarding] Wizard shown for new signup');
        } else {
          console.warn('[Onboarding] ob-overlay element not found in DOM');
        }
      }, 50);

      // Don't reload — let the auth state change naturally
      // window.location.reload();
    }
  }
}

async function handleSignOut() {
  await signOut();
  // Clear any stuck modal
  hideAuthModal();
  window.location.reload();
}

// ── Auto-Initialize ─────────────────────────────────────────────────────────────
// Initialize when the script loads, but wait for DOM to be ready for UI
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSupabase);
} else {
  initSupabase();
}

// ── Auth Modal MutationObserver (safety net) ──────────────────────────────────
// If the auth modal is ever added or shown while the user is authenticated, hide it immediately
(function _setupAuthModalWatcher() {
  function _forceHideIfAuth() {
    if (isAuthenticated()) {
      const modal = document.getElementById("auth-modal");
      if (modal) {
        modal.style.display = "none";
        modal.classList.add("auth-modal-hidden");
      }
      document.body.setAttribute("data-authenticated", "true");
    }
  }
  // Watch for DOM changes that might add or modify the auth modal
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && (node.id === "auth-modal" || node.querySelector?.("#auth-modal"))) {
            _forceHideIfAuth();
            return;
          }
        }
      }
      if (mutation.type === "attributes" && mutation.target.id === "auth-modal") {
        _forceHideIfAuth();
        return;
      }
    }
  });
  // Start observing once DOM is ready
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    });
  }
  // Also run a periodic check every 2 seconds for 30 seconds after page load
  let checks = 0;
  const interval = setInterval(() => {
    _forceHideIfAuth();
    checks++;
    if (checks >= 15) clearInterval(interval);
  }, 2000);
  // Run immediately once
  _forceHideIfAuth();
})();
