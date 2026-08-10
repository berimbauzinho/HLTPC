(() => {
  "use strict";

  const form = document.querySelector("#loginForm");
  const error = document.querySelector("#loginError");
  const submit = form.querySelector("button[type='submit']");
  const changeForm = document.querySelector("#changePasswordForm");
  const changeError = document.querySelector("#changePasswordError");

  function showError(message) {
    error.textContent = message;
    error.classList.add("show");
  }

  function enterAdmin(user) {
    window.HLTPC_CURRENT_USER = user;
    document.querySelector("#currentUser").textContent = `${user.username} · ${user.role}`;
    document.querySelector("#currentInitials").textContent = user.username.slice(0, 2).toUpperCase();
    document.body.classList.add("authenticated");
    document.querySelectorAll("[data-owner-only]").forEach((element) => { element.hidden = user.role !== "owner"; });
  }

  function requireNewPassword(user) {
    window.HLTPC_CURRENT_USER = user;
    form.hidden = true;
    changeForm.hidden = false;
    changeForm.querySelector("input").focus();
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
      if (result.user.mustChangePassword) requireNewPassword(result.user); else enterAdmin(result.user);
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
      if (result.user.mustChangePassword) requireNewPassword(result.user); else enterAdmin(result.user);
    } catch (reason) {
      showError(reason.message);
    } finally {
      submit.disabled = false;
      submit.textContent = "Entrar";
    }
  });

  changeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    changeError.classList.remove("show");
    const values = Object.fromEntries(new FormData(changeForm).entries());
    if (values.password !== values.confirmation) {
      changeError.textContent = "As duas senhas precisam ser iguais.";
      changeError.classList.add("show");
      return;
    }
    const button = changeForm.querySelector("button");
    button.disabled = true;
    button.textContent = "Salvando...";
    try {
      const result = await request("/api/admin/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: values.password }) });
      changeForm.reset();
      enterAdmin(result.user);
    } catch (reason) {
      changeError.textContent = reason.message;
      changeError.classList.add("show");
    } finally {
      button.disabled = false;
      button.textContent = "Salvar nova senha";
    }
  });

  document.querySelector("#logoutButton").addEventListener("click", async () => {
    await request("/api/admin/logout", { method: "POST" }).catch(() => {});
    location.reload();
  });

  restoreSession();
})();
