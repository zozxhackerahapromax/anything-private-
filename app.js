import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const configured = SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('YOUR_') && !SUPABASE_ANON_KEY.includes('YOUR_');
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (selector) => document.querySelector(selector);
const state = { user: null, profile: null, orders: [], isSignup: false, pendingPhone: '', selectedPaymentOrder: null, messageChannel: null };
const toast = (message) => { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 3600); };
const safe = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const formatDate = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date to be confirmed';

function requireConfig() {
  if (configured) return true;
  toast('Add your Supabase URL and anon key in config.js to connect the app.');
  return false;
}
function showAuth() { $('#authDialog').showModal(); $('#authError').textContent = ''; }
function setSignupMode(signup) {
  state.isSignup = signup;
  $('#authTitle').textContent = signup ? 'Create your account' : 'Sign in';
  $('#authDescription').textContent = signup ? 'Create an account with your phone number and a password.' : 'Use your phone number and password to continue.';
  $('#confirmPasswordWrap').classList.toggle('hidden', !signup);
  $('#confirmPassword').required = signup;
  $('#authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  $('#switchPrompt').textContent = signup ? 'Already have an account?' : 'New to HaYaM?';
  $('#switchAuth').textContent = signup ? 'Sign in' : 'Create an account';
  $('#authError').textContent = '';
}
function showSignedIn(user, profile) {
  state.user = user; state.profile = profile;
  $('#accountButton').textContent = 'My account';
  $('#signedInAs').textContent = `Signed in as ${user.phone || 'your account'}`;
  $('#accountArea').classList.remove('hidden');
  $('#adminArea').classList.toggle('hidden', profile?.role !== 'admin');
  $('#orderForm').querySelector('button[type="submit"]').innerHTML = 'Place your cake request <span>→</span>';
  loadOrders();
  $('#accountArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadProfile(user) {
  const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) console.error('Could not load profile:', error.message);
  return data || { role: 'customer' };
}
async function refreshSession() {
  if (!configured) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) showSignedIn(session.user, await loadProfile(session.user));
}

$('#accountButton').addEventListener('click', () => state.user ? $('#accountArea').scrollIntoView({ behavior: 'smooth' }) : (setSignupMode(false), showAuth()));
$('#closeAuth').addEventListener('click', () => $('#authDialog').close());
$('#switchAuth').addEventListener('click', () => setSignupMode(!state.isSignup));
$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!requireConfig()) return;
  const phone = $('#authPhone').value.trim(); const password = $('#authPassword').value;
  $('#authError').textContent = '';
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) { $('#authError').textContent = 'Enter your phone number in international format, for example +201012345678.'; return; }
  if (state.isSignup && password !== $('#confirmPassword').value) { $('#authError').textContent = 'Your passwords do not match.'; return; }
  $('#authSubmit').disabled = true;
  try {
    if (state.isSignup) {
      const { data, error } = await supabase.auth.signUp({ phone, password });
      if (error) throw error;
      if (data.session) { $('#authDialog').close(); showSignedIn(data.user, await loadProfile(data.user)); toast('Your account is ready!'); }
      else { state.pendingPhone = phone; $('#authFields').classList.add('hidden'); $('#otpFields').classList.remove('hidden'); $('#authTitle').textContent = 'Verify your phone'; $('#authDescription').textContent = 'Enter the verification code sent to your phone.'; }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ phone, password });
      if (error) throw error;
      $('#authDialog').close(); showSignedIn(data.user, await loadProfile(data.user)); toast('Welcome back!');
    }
  } catch (error) { $('#authError').textContent = error.message || 'We could not complete sign-in. Please try again.'; }
  finally { $('#authSubmit').disabled = false; }
});
$('#verifyOtpButton').addEventListener('click', async () => {
  const token = $('#otpCode').value.trim(); $('#otpError').textContent = '';
  if (!token) { $('#otpError').textContent = 'Enter the code sent to your phone.'; return; }
  $('#verifyOtpButton').disabled = true;
  try {
    const { data, error } = await supabase.auth.verifyOtp({ phone: state.pendingPhone, token, type: 'sms' });
    if (error) throw error;
    $('#authDialog').close(); $('#authFields').classList.remove('hidden'); $('#otpFields').classList.add('hidden');
    showSignedIn(data.user, await loadProfile(data.user)); toast('Phone verified. Your account is ready!');
  } catch (error) { $('#otpError').textContent = error.message || 'That code could not be verified.'; }
  finally { $('#verifyOtpButton').disabled = false; }
});
$('#signOutButton').addEventListener('click', async () => { if (!supabase) return; await supabase.auth.signOut(); state.user = null; state.profile = null; state.orders = []; $('#accountArea').classList.add('hidden'); $('#adminArea').classList.add('hidden'); $('#accountButton').textContent = 'Sign in'; toast('You are signed out.'); });

$('#orderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.user) { setSignupMode(false); showAuth(); toast('Sign in before placing your order.'); return; }
  const order = { customer_id: state.user.id, cake_name: $('#cakeName').value, cake_size: $('#cakeSize').value, needed_by: $('#neededBy').value || null, description: $('#description').value.trim(), status: 'pending' };
  const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const { error } = await supabase.from('orders').insert(order);
    if (error) throw error;
    event.currentTarget.reset(); toast('Your cake request is in! Our team will be in touch.'); await loadOrders();
    $('#accountArea').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { toast(error.message || 'Could not place your order. Please try again.'); }
  finally { button.disabled = false; }
});
document.querySelectorAll('[data-cake]').forEach((link) => link.addEventListener('click', () => { $('#cakeName').value = link.dataset.cake; }));

async function loadOrders() {
  if (!state.user) return;
  const { data, error } = await supabase.from('orders').select('id,customer_id,cake_name,cake_size,needed_by,description,status,created_at,payment_path').order('created_at', { ascending: false });
  if (error) { console.error(error); $('#ordersList').innerHTML = '<p class="muted">Could not load orders. Please refresh.</p>'; return; }
  state.orders = data || []; renderOrders(); renderChatOrderOptions();
  if (state.profile?.role === 'admin') renderAdminOrders();
}
const statusLabel = (status) => ({ pending: 'Awaiting review', approved: 'Approved', payment_submitted: 'Payment under review', confirmed: 'Confirmed', declined: 'Needs an update' })[status] || status;
function renderOrders() {
  const list = $('#ordersList');
  if (!state.orders.length) { list.innerHTML = '<p class="muted">Your first sweet creation is just a few clicks away. Place an order above!</p>'; return; }
  list.innerHTML = state.orders.map((order) => `<article class="order-item"><div class="order-item-top"><div><h4>${safe(order.cake_name)}</h4><p>${safe(order.cake_size)} · ${formatDate(order.needed_by)}</p></div><span class="status-pill status-${safe(order.status)}">${safe(statusLabel(order.status))}</span></div><p class="order-description">${safe(order.description)}</p>${order.status === 'approved' ? `<button class="button button-outline pay-button" data-pay="${safe(order.id)}">Upload InstaPay receipt</button>` : ''}</article>`).join('');
  document.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => { state.selectedPaymentOrder = button.dataset.pay; $('#paymentError').textContent = ''; $('#paymentDialog').showModal(); }));
}
function renderChatOrderOptions() {
  const select = $('#chatOrderSelect'); const prior = select.value;
  select.innerHTML = '<option value="">Choose an order</option>' + state.orders.map((order) => `<option value="${safe(order.id)}">${safe(order.cake_name)} · ${safe(statusLabel(order.status))}</option>`).join('');
  if (state.orders.some((order) => order.id === prior)) select.value = prior;
}

$('#closePayment').addEventListener('click', () => $('#paymentDialog').close());
$('#paymentForm').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!state.selectedPaymentOrder) return;
  const file = $('#paymentImage').files[0]; const errorBox = $('#paymentError'); errorBox.textContent = '';
  if (!file || !file.type.startsWith('image/')) { errorBox.textContent = 'Choose an image file for your receipt.'; return; }
  if (file.size > 8 * 1024 * 1024) { errorBox.textContent = 'Please choose an image smaller than 8 MB.'; return; }
  const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const path = `${state.user.id}/${state.selectedPaymentOrder}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_')}`;
    const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from('orders').update({ payment_path: path, status: 'payment_submitted' }).eq('id', state.selectedPaymentOrder).eq('customer_id', state.user.id);
    if (error) { await supabase.storage.from('payment-proofs').remove([path]); throw error; }
    $('#paymentDialog').close(); event.currentTarget.reset(); toast('Receipt uploaded securely. Our admin will review it manually.'); await loadOrders();
  } catch (error) { errorBox.textContent = error.message || 'Could not upload the receipt. Please try again.'; }
  finally { button.disabled = false; }
});

$('#chatOrderSelect').addEventListener('change', loadChatMessages);
async function loadChatMessages() {
  if (state.messageChannel) { await supabase.removeChannel(state.messageChannel); state.messageChannel = null; }
  const orderId = $('#chatOrderSelect').value;
  if (!orderId) { $('#chatMessages').innerHTML = '<p class="muted">Choose an order to start chatting with our team.</p>'; return; }
  const { data, error } = await supabase.from('messages').select('id,sender_id,body,created_at').eq('order_id', orderId).order('created_at');
  if (error) { $('#chatMessages').innerHTML = '<p class="muted">Could not load messages.</p>'; return; }
  drawMessages(data || []);
  state.messageChannel = supabase.channel(`messages-${orderId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` }, (payload) => appendMessage(payload.new)).subscribe();
}
function drawMessages(messages) {
  const box = $('#chatMessages'); box.innerHTML = messages.length ? messages.map(messageMarkup).join('') : '<p class="muted">No messages yet. Send us a message if you have a question.</p>'; box.scrollTop = box.scrollHeight;
}
function messageMarkup(message) { return `<div class="chat-bubble ${message.sender_id === state.user?.id ? 'mine' : 'theirs'}"><p>${safe(message.body)}</p><time>${new Date(message.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time></div>`; }
function appendMessage(message) { const box = $('#chatMessages'); box.querySelector('.muted')?.remove(); if (!box.querySelector(`[data-message="${message.id}"]`)) box.insertAdjacentHTML('beforeend', `<div data-message="${safe(message.id)}">${messageMarkup(message)}</div>`); box.scrollTop = box.scrollHeight; }
$('#chatForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const orderId = $('#chatOrderSelect').value; const body = $('#chatInput').value.trim(); if (!orderId || !body) { toast('Choose an order before sending a message.'); return; }
  const { error } = await supabase.from('messages').insert({ order_id: orderId, sender_id: state.user.id, body });
  if (error) { toast(error.message || 'Message could not be sent.'); return; }
  $('#chatInput').value = '';
});

async function renderAdminOrders() {
  const container = $('#adminOrders');
  if (!state.orders.length) { container.innerHTML = '<p class="muted">No orders yet.</p>'; return; }
  const cards = await Promise.all(state.orders.map(async (order) => {
    let receiptLink = '';
    if (order.payment_path) {
      const { data } = await supabase.storage.from('payment-proofs').createSignedUrl(order.payment_path, 120);
      if (data?.signedUrl) receiptLink = `<a class="receipt-link" href="${safe(data.signedUrl)}" target="_blank" rel="noopener">View private receipt ↗</a>`;
    }
    return `<article class="admin-order"><div class="order-item-top"><div><span class="eyebrow">${safe(order.customer_id.slice(0, 8))} · ${new Date(order.created_at).toLocaleDateString()}</span><h3>${safe(order.cake_name)} <span class="muted">· ${safe(order.cake_size)}</span></h3></div><span class="status-pill status-${safe(order.status)}">${safe(statusLabel(order.status))}</span></div><p>${safe(order.description)}</p><p class="muted">Needed by: ${formatDate(order.needed_by)}</p>${receiptLink}<div class="admin-actions"><select data-status-for="${safe(order.id)}" aria-label="Update order status"><option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Awaiting review</option><option value="approved" ${order.status === 'approved' ? 'selected' : ''}>Approve order</option><option value="payment_submitted" ${order.status === 'payment_submitted' ? 'selected' : ''}>Payment under review</option><option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirm payment</option><option value="declined" ${order.status === 'declined' ? 'selected' : ''}>Needs an update</option></select><button class="button button-outline" data-save-status="${safe(order.id)}">Save status</button><button class="button button-light" data-admin-chat="${safe(order.id)}">Open chat</button></div></article>`;
  }));
  container.innerHTML = cards.join('');
  container.querySelectorAll('[data-save-status]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.saveStatus; const status = container.querySelector(`[data-status-for="${id}"]`).value;
    const { error } = await supabase.from('orders').update({ status }).eq('id', id);
    if (error) toast(error.message || 'Could not update order.'); else { toast('Order status updated.'); await loadOrders(); }
  }));
  container.querySelectorAll('[data-admin-chat]').forEach((button) => button.addEventListener('click', () => { $('#chatOrderSelect').value = button.dataset.adminChat; $('#chatOrderSelect').dispatchEvent(new Event('change')); $('#accountArea').scrollIntoView({ behavior: 'smooth' }); }));
}

if (configured) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user && !state.user) setTimeout(async () => showSignedIn(session.user, await loadProfile(session.user)), 0);
    if (event === 'SIGNED_OUT') { state.user = null; $('#accountArea').classList.add('hidden'); $('#adminArea').classList.add('hidden'); }
  });
  refreshSession();
}
