import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import { renderLogin } from './components/login';
import { renderDashboard } from './components/dashboard';
import { renderProductForm } from './components/product-form';
import { renderMigrate } from './components/migrate';
import './style.css';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    renderApp();
    window.addEventListener('hashchange', renderApp);
  } else {
    window.removeEventListener('hashchange', renderApp);
    renderLogin(app);
  }
});

function renderApp() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }

  const hash = window.location.hash || '#productos';
  const isAgregar = hash === '#agregar';
  const isMigrar = hash === '#migrar';
  const editMatch = hash.match(/^#editar\/(.+)$/);

  app.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">miMercadito</h1>
      <button class="btn btn-secondary btn-sm" id="logout-btn">Salir</button>
    </header>
    <nav class="tab-nav">
      <a class="tab ${!isAgregar && !isMigrar && !editMatch ? 'active' : ''}" href="#productos">Productos</a>
      <a class="tab ${isAgregar ? 'active' : ''}" href="#agregar">Agregar</a>
      <a class="tab ${isMigrar ? 'active' : ''}" href="#migrar">Migrar</a>
    </nav>
    <main class="content" id="view"></main>
  `;

  document.getElementById('logout-btn')!.addEventListener('click', () => signOut(auth));

  const view = document.getElementById('view')!;

  if (isAgregar) {
    renderProductForm(view);
  } else if (isMigrar) {
    renderMigrate(view);
  } else if (editMatch) {
    renderProductForm(view, editMatch[1]);
  } else {
    cleanup = renderDashboard(view) || null;
  }
}
