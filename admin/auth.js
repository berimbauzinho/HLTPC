(() => {
  "use strict";

  const form = document.querySelector("#loginForm");
  const error = document.querySelector("#loginError");
  const submit = form.querySelector("button[type='submit']");

  function showError(message) {
    error.textContent = message;
    error.classList.add("show");
  }

  function enterAdmin(user) {
    window.HLTPC_CURRENT_USER = user;
    document.querySelector("#currentUser").textContent = `${user.username} · ${user.role}`;
    document.querySelector("#currentInitials").textContent = user.username.slice(0, 2).toUpperCase();
    document.body.classList.add("authenticated");
  }

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível entrar agora.");
    return result;
  }

  async function restoreSession() {
    try {
      const result = await request("/api/admin/session");
      enterAdmin(result.user);
    } catch (_) {
      document.querySelector("#loginScreen").hidden = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.classList.remove("show");
    submit.disabled = true;
    submit.textContent = "Entrando...";
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const result = await request("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      form.reset();
      enterAdmin(result.user);
    } catch (reason) {
      showError(reason.message);
    } finally {
      submit.disabled = false;
      submit.textContent = "Entrar";
    }
  });

  document.querySelector("#logoutButton").addEventListener("click", async () => {
    await request("/api/admin/logout", { method: "POST" }).catch(() => {});
    location.reload();
  });

  restoreSession();
})();
