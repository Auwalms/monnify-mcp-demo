const POLL_INTERVAL_MS = 4000;

let appState = {
  user: null,
  userId: null,
  mandateId: null,
  resolvedAccountName: null,
};

function maskLast4(value) {
  if (!value) return '—';
  const digits = String(value).replace(/\D/g, '');
  return digits.length <= 4 ? value : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.style.borderColor = isError ? '#ef4444' : '';
  toast.style.backgroundColor = isError ? '#fef2f2' : '';
  toast.style.color = isError ? '#991b1b' : '';
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 4000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
  return data;
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.add('hidden');
  appState.userId = null;
  appState.user = null;
  sessionStorage.removeItem('userId');
  sessionStorage.removeItem('adminPassword');
}

function showDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  document.getElementById('admin-screen').classList.add('hidden');
}

function showAdmin() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.remove('hidden');
  loadMandates();
}

async function loadAvailableEmails() {
  try {
    const { emails } = await api('/api/auth/emails');
    const suggestionsDiv = document.getElementById('email-suggestions');
    suggestionsDiv.innerHTML = emails
      .map(
        (e) => `
        <button
          type="button"
          class="w-full text-left px-3 py-2 text-sm border border-slate-300 rounded hover:bg-blue-50 transition"
          onclick="document.getElementById('login-email').value = '${e.email}'; this.closest('#email-suggestions').innerHTML = '';"
        >
          <span class="font-medium">${e.name}</span>
          <span class="text-slate-500 block text-xs">${e.email}</span>
        </button>
      `,
      )
      .join('');
  } catch (err) {
    console.error('Failed to load emails:', err);
  }
}

async function handleLogin(email) {
  try {
    const { userId } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    appState.userId = userId;
    sessionStorage.setItem('userId', userId);
    showDashboard();
    await refresh();
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
    document.getElementById('login-error').classList.remove('hidden');
  }
}

function render() {
  const user = appState.user;
  if (!user) return;

  document.getElementById('user-greeting').textContent = user.firstName;
  document.getElementById('wallet-balance').textContent = formatMoney(user.wallet.balance);

  if (user.directDebit.mandate && user.directDebit.mandate.status === 'ACTIVE') {
    document.getElementById('wallet-status').textContent = `Monthly: ₦${formatMoney(user.directDebit.mandate.amount)}`;
  }

  renderMandateCard(user.directDebit.mandate, user.directDebit.payer);
  renderEvents(user.events || []);
}

function renderMandateCard(mandate, payer) {
  const noneEl = document.getElementById('mandate-none');
  const existingEl = document.getElementById('mandate-existing');

  if (!mandate) {
    noneEl.classList.remove('hidden');
    existingEl.classList.add('hidden');
    return;
  }

  noneEl.classList.add('hidden');
  existingEl.classList.remove('hidden');

  appState.mandateId = mandate.mandateCode;

  document.getElementById('mandate-existing-amount').textContent = formatMoney(mandate.amount);
  document.getElementById('mandate-existing-bank').textContent = payer
    ? `${payer.accountName} · ${maskLast4(payer.accountNumber)}`
    : '—';

  const badge = document.getElementById('mandate-badge');
  const pendingActions = document.getElementById('mandate-pending-actions');
  const isActive = mandate.status === 'ACTIVE';

  badge.textContent = isActive ? 'Active' : mandate.status.replace(/_/g, ' ');
  badge.className = `px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
    isActive ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
  }`;

  pendingActions.classList.toggle('hidden', isActive);
}

function renderEvents(events) {
  const log = document.getElementById('event-log');
  if (!events.length) {
    log.innerHTML = '<li class="text-sm text-slate-500">No transactions yet</li>';
    return;
  }
  log.innerHTML = events
    .slice()
    .reverse()
    .slice(0, 10)
    .map(
      (event) => {
        const date = new Date(event.timestamp);
        const dateTime = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        return `
        <li class="flex items-start justify-between text-sm border-l-4 border-blue-500 pl-3">
          <span class="font-medium text-slate-900">${event.message}</span>
          <time class="text-xs text-slate-500 whitespace-nowrap ml-2">${dateTime}</time>
        </li>`;
      }
    )
    .join('');
}

async function refresh() {
  if (!appState.userId) return;
  try {
    appState.user = await api(`/api/user?userId=${appState.userId}`);
    render();
  } catch (err) {
    console.error('Refresh failed:', err);
    showLoginScreen();
  }
}

async function setupCheckout() {
  const amountInput = document.getElementById('checkout-amount');
  const button = document.getElementById('checkout-btn');

  button.addEventListener('click', async () => {
    const amount = Number(amountInput.value);
    if (!amount || amount <= 0) {
      showToast('Enter a positive amount', true);
      return;
    }

    try {
      button.disabled = true;
      const { checkoutUrl } = await api('/api/wallet/checkout', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });

      // Open checkout in new window and poll for balance updates
      const checkoutWindow = window.open(checkoutUrl, 'monnify-checkout', 'width=600,height=700');
      showToast('Checkout opened — complete payment and return to fund your wallet');
      amountInput.value = '';

      // Poll more frequently while checkout is open
      const pollInterval = setInterval(() => {
        if (checkoutWindow.closed) {
          clearInterval(pollInterval);
          refresh();
          showToast('Returning from payment — your balance will update shortly');
        }
      }, 1000);

    } catch (err) {
      showToast(err.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

async function setupRecurringModal() {
  const modal = document.getElementById('recurring-modal');
  const openBtn = document.getElementById('recurring-setup-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');

  openBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
  });

  cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    resetMandateForm();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
      resetMandateForm();
    }
  });
}

function resetMandateForm() {
  document.getElementById('mandate-bank-select').value = '';
  document.getElementById('mandate-account-number').value = '';
  document.getElementById('mandate-amount').value = '';
  document.getElementById('mandate-resolved-name').classList.add('hidden');
  document.getElementById('mandate-post-create').classList.add('hidden');
  document.getElementById('mandate-create-btn').disabled = true;
  appState.resolvedAccountName = null;
  appState.mandateId = null;
}

async function setupBankList() {
  try {
    const { banks } = await api('/api/banks');
    const select = document.getElementById('mandate-bank-select');
    select.innerHTML = banks.map((bank) => `<option value="${bank.code}">${bank.name}</option>`).join('');
  } catch (err) {
    console.error('Failed to load banks:', err);
    showToast('Could not load bank list', true);
  }
}

async function setupMandateFlow() {
  const bankSelect = document.getElementById('mandate-bank-select');
  const accountInput = document.getElementById('mandate-account-number');
  const verifyBtn = document.getElementById('mandate-verify-btn');
  const resolvedNameEl = document.getElementById('mandate-resolved-name');
  const amountInput = document.getElementById('mandate-amount');
  const createBtn = document.getElementById('mandate-create-btn');
  const postCreateSection = document.getElementById('mandate-post-create');
  const statusBtn = document.getElementById('mandate-status-btn');
  const statusResult = document.getElementById('mandate-status-result');
  const authoriseBtn = document.getElementById('mandate-authorise-btn');
  const authoriseResult = document.getElementById('mandate-authorise-result');

  verifyBtn.addEventListener('click', async () => {
    const bankCode = bankSelect.value;
    const accountNumber = accountInput.value.trim();

    if (!bankCode) {
      showToast('Please select a bank', true);
      return;
    }

    if (accountNumber.length !== 10 || !/^\d+$/.test(accountNumber)) {
      showToast('Account number must be exactly 10 digits', true);
      return;
    }

    try {
      verifyBtn.disabled = true;
      const { accountName } = await api('/api/wallet/resolve-account', {
        method: 'POST',
        body: JSON.stringify({ bankCode, accountNumber }),
      });
      appState.resolvedAccountName = accountName;
      resolvedNameEl.textContent = `✓ Verified: ${accountName}`;
      resolvedNameEl.classList.remove('hidden');
      createBtn.disabled = false;
    } catch (err) {
      showToast(err.message, true);
      createBtn.disabled = true;
      appState.resolvedAccountName = null;
    } finally {
      verifyBtn.disabled = false;
    }
  });

  createBtn.addEventListener('click', async () => {
    if (!appState.resolvedAccountName) {
      showToast('Verify account first', true);
      return;
    }

    const amount = Number(amountInput.value);
    if (!amount || amount <= 0) {
      showToast('Enter a valid amount', true);
      return;
    }

    try {
      createBtn.disabled = true;
      const result = await api('/api/wallet/mandate', {
        method: 'POST',
        body: JSON.stringify({
          bankCode: bankSelect.value,
          accountNumber: accountInput.value.trim(),
          accountName: appState.resolvedAccountName,
          amount,
          frequency: 'MONTHLY',
        }),
      });
      appState.mandateId = result.mandateId;
      showToast('Mandate created — proceed to authorization');
      postCreateSection.classList.remove('hidden');
      await refresh();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      createBtn.disabled = false;
    }
  });

  statusBtn.addEventListener('click', async () => {
    if (!appState.mandateId) return;
    try {
      statusBtn.disabled = true;
      const result = await api(`/api/wallet/mandate/${appState.mandateId}/status`);
      statusResult.textContent = result.message || 'Status retrieved.';
    } catch (err) {
      showToast(err.message, true);
    } finally {
      statusBtn.disabled = false;
    }
  });

  authoriseBtn.addEventListener('click', async () => {
    if (!appState.mandateId) return;
    try {
      authoriseBtn.disabled = true;
      const result = await api(`/api/wallet/mandate/${appState.mandateId}/authorise`, { method: 'POST' });
      authoriseResult.textContent = result.message || 'Mandate authorized!';
      showToast('Monthly contribution activated!');
      setTimeout(() => {
        document.getElementById('recurring-modal').classList.add('hidden');
        resetMandateForm();
        refresh();
      }, 1000);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      authoriseBtn.disabled = false;
    }
  });
}

function setupDashboardMandateActions() {
  const statusBtn = document.getElementById('dashboard-mandate-status-btn');
  const authoriseBtn = document.getElementById('dashboard-mandate-authorise-btn');

  statusBtn.addEventListener('click', async () => {
    if (!appState.mandateId) return;
    try {
      statusBtn.disabled = true;
      const result = await api(`/api/wallet/mandate/${appState.mandateId}/status`);
      showToast(result.message || 'Status retrieved.');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      statusBtn.disabled = false;
    }
  });

  authoriseBtn.addEventListener('click', async () => {
    if (!appState.mandateId) return;
    try {
      authoriseBtn.disabled = true;
      const result = await api(`/api/wallet/mandate/${appState.mandateId}/authorise`, { method: 'POST' });
      showToast(result.message || 'Mandate authorized!');
      await refresh();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      authoriseBtn.disabled = false;
    }
  });
}

async function loadMandates() {
  try {
    const { mandates } = await api('/api/admin/mandates');
    const container = document.getElementById('mandates-container');
    const listDiv = document.getElementById('mandates-list');
    const noMandatesDiv = document.getElementById('no-mandates');

    if (!mandates.length) {
      container.classList.add('hidden');
      noMandatesDiv.classList.remove('hidden');
      return;
    }

    noMandatesDiv.classList.add('hidden');
    container.classList.remove('hidden');

    listDiv.innerHTML = mandates
      .map(
        (m) => `
        <div class="bg-white rounded-lg p-6 border border-slate-200">
          <div class="flex justify-between items-start mb-4">
            <div>
              <h3 class="text-lg font-semibold">${m.userName}</h3>
              <p class="text-sm text-slate-600">${m.email}</p>
            </div>
            <span class="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">${m.mandate.status}</span>
          </div>

          <div class="grid grid-cols-2 gap-4 mb-4 text-sm">
            <div>
              <p class="text-slate-600">Monthly Amount</p>
              <p class="font-semibold">₦${m.mandate.amount.toLocaleString()}</p>
            </div>
            <div>
              <p class="text-slate-600">Frequency</p>
              <p class="font-semibold">${m.mandate.frequency}</p>
            </div>
            <div>
              <p class="text-slate-600">Created</p>
              <p class="font-semibold">${new Date(m.mandate.createdAt).toLocaleDateString()}</p>
            </div>
            <div>
              <p class="text-slate-600">Last Debit</p>
              <p class="font-semibold">${m.mandate.lastDebitDate || 'Never'}</p>
            </div>
          </div>

          <details class="mb-4">
            <summary class="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-700">View Debit History (${m.mandate.debitHistory.length})</summary>
            <div class="mt-2 space-y-2 pl-4">
              ${
                m.mandate.debitHistory.length === 0
                  ? '<p class="text-sm text-slate-500">No debits yet</p>'
                  : m.mandate.debitHistory
                      .map(
                        (h) => `
                      <div class="text-sm border-l-2 border-slate-300 pl-3 py-1">
                        <p class="text-slate-900">${new Date(h.date).toLocaleString()}</p>
                        <p class="text-slate-600">₦${h.amount.toLocaleString()} - ${h.status}</p>
                      </div>
                    `
                      )
                      .join('')
              }
            </div>
          </details>

          <button
            onclick="triggerDebit('${m.userId}', '${m.userName}', ${m.mandate.amount})"
            class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition"
          >
            Trigger Debit Now
          </button>
        </div>
      `
      )
      .join('');
  } catch (err) {
    console.error('Failed to load mandates:', err);
    showToast('Failed to load mandates', true);
  }
}

async function triggerDebit(userId, userName, amount) {
  const password = sessionStorage.getItem('adminPassword');
  if (!password) {
    showToast('Please re-enter admin password', true);
    return;
  }

  try {
    await api(`/api/admin/mandate/${userId}/debit`, {
      method: 'POST',
      headers: { 'x-admin-password': password },
    });
    showToast(`✓ Debitted ₦${amount.toLocaleString()} from ${userName}`);
    await loadMandates();
  } catch (err) {
    showToast(err.message, true);
  }
}

function setupAdminAccess() {
  const passwordInput = document.getElementById('admin-password-input');
  const passwordBtn = document.getElementById('admin-password-btn');
  const adminError = document.getElementById('admin-error');
  const adminLogoutBtn = document.getElementById('admin-logout-btn');

  passwordBtn.addEventListener('click', async () => {
    const password = passwordInput.value.trim();
    if (!password) {
      adminError.textContent = 'Please enter a password';
      adminError.classList.remove('hidden');
      return;
    }

    try {
      // Test the password by trying to load mandates
      const res = await fetch('/api/admin/mandates', {
        headers: { 'x-admin-password': password },
      });
      if (!res.ok) throw new Error('Invalid password');

      sessionStorage.setItem('adminPassword', password);
      document.getElementById('admin-password-modal').classList.add('hidden');
      await loadMandates();
    } catch (err) {
      adminError.textContent = 'Invalid password';
      adminError.classList.remove('hidden');
    }
  });

  adminLogoutBtn.addEventListener('click', () => {
    showLoginScreen();
  });

  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') passwordBtn.click();
  });
}

// Initialize
(async () => {
  const form = document.getElementById('login-form');
  const loginEmail = document.getElementById('login-email');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');

  // Check for admin access
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('admin') === 'true' || sessionStorage.getItem('adminPassword')) {
    setupAdminAccess();
    showAdmin();
  } else if (sessionStorage.getItem('userId')) {
    // Check if already logged in
    appState.userId = sessionStorage.getItem('userId');
    showDashboard();
    setupBankList();
    setupCheckout();
    setupRecurringModal();
    setupMandateFlow();
    setupDashboardMandateActions();
    await refresh();
    setInterval(refresh, POLL_INTERVAL_MS);
  } else {
    showLoginScreen();
    await loadAvailableEmails();
  }

  // Login form handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginEmail.value.trim();
    if (!email) {
      showToast('Please enter an email', true);
      return;
    }
    loginBtn.disabled = true;
    try {
      await handleLogin(email);
      setupBankList();
      setupCheckout();
      setupRecurringModal();
      setupMandateFlow();
      setupDashboardMandateActions();
      setInterval(refresh, POLL_INTERVAL_MS);
    } catch (err) {
      // Error is shown by handleLogin
    } finally {
      loginBtn.disabled = false;
    }
  });

  // Logout handler
  logoutBtn.addEventListener('click', () => {
    showLoginScreen();
    loadAvailableEmails();
    loginEmail.value = '';
    document.getElementById('login-error').classList.add('hidden');
  });
})();
