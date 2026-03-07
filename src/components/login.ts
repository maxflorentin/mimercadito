import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { showToast } from '../lib/toast';

const ALLOWED_EMAILS = ['macsee13@gmail.com', 'romi.fndz87@gmail.com'];

export function renderLogin(container: HTMLElement) {
  container.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-icon">🏪</div>
        <h1>miMercadito</h1>
        <p>Inventario y ventas personal</p>
        <button class="btn btn-primary login-btn" id="google-login">
          Iniciar con Google
        </button>
      </div>
    </div>
  `;

  document.getElementById('google-login')!.addEventListener('click', async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email || '';
      if (!ALLOWED_EMAILS.includes(email)) {
        await auth.signOut();
        showToast('Email no autorizado', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesion';
      showToast(msg, 'error');
    }
  });
}
