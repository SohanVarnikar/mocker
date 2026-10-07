// API Mocker — minimal shared wireframe interactivity

function initTabs(root) {
  const tabs = root.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const group = tab.closest('.tabs');
      const panelId = tab.getAttribute('data-tab-target');
      group.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const panelsRoot = group.parentElement;
      panelsRoot.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = panelsRoot.querySelector('#' + panelId);
      if (panel) panel.classList.add('active');
    });
  });
}

function initToggles() {
  document.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('on');
    });
  });
}

function initScenarioRadios() {
  document.querySelectorAll('.scenario-card').forEach(card => {
    const radio = card.querySelector('.radio-active input');
    if (!radio) return;
    radio.addEventListener('change', () => {
      const group = card.closest('.scenarios-list');
      group.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('is-active'));
      card.classList.add('is-active');
    });
  });
}

function initChips() {
  document.querySelectorAll('.chip-row').forEach(row => {
    row.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  });
}

function initLogDrawer() {
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('logDrawer');
  if (!overlay || !drawer) return;

  const titleEl = document.getElementById('drawerTitle');
  const subEl = document.getElementById('drawerSub');
  const reqBody = document.getElementById('drawerReqBody');
  const resBody = document.getElementById('drawerResBody');
  const statusEl = document.getElementById('drawerStatus');

  document.querySelectorAll('tr[data-log-row]').forEach(row => {
    row.addEventListener('click', () => {
      document.querySelectorAll('tr[data-log-row]').forEach(r => r.classList.remove('row-selected'));
      row.classList.add('row-selected');

      titleEl.textContent = row.dataset.method + '  ' + row.dataset.path;
      subEl.textContent = row.dataset.endpoint + ' · scenario: ' + row.dataset.scenario;
      statusEl.innerHTML = row.querySelector('.status-pill').innerHTML;
      reqBody.textContent = row.dataset.reqbody || '{}';
      resBody.textContent = row.dataset.resbody || '{}';

      overlay.classList.add('open');
      drawer.classList.add('open');
    });
  });

  function closeDrawer() {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
  }

  document.getElementById('drawerClose').addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tabs').forEach(initTabs);
  initToggles();
  initScenarioRadios();
  initChips();
  initLogDrawer();
});
