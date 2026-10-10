// SPDX-License-Identifier: AGPL-3.0-only
//
// First-party adapter for `window.SimplexWebTransport`.
//
// The public facade in `src/transport.js` is intentionally stable and small:
// websites call `sendText`, `sendFiles`, `getMessages`, and `connect`.
// This module supplies the real browser-native adapter behind that facade. It
// wires the binary SMP-over-WebSocket profile, durable browser store, contact
// client, and optional XFTP web file client together without introducing a
// plaintext server bridge.

import {
  decodeBase64Url,
  encodeBase64Url,
  hexToBytes,
  parseSimplexConnectionLink,
  toBytes
} from './browser-smp-core.mjs';
import { createBrowserSimplexClient } from './browser-simplex-client.mjs';
import { createBrowserSimplexContactClient } from './browser-simplex-contact-client.mjs';
import { createBrowserSimplexStore } from './browser-simplex-store.mjs';
import { connectBrowserSmpWebSocketTransport } from './browser-smp-websocket-transport.mjs';
import {
  connectBrowserXftpWebClient,
  downloadXftpWebFile,
  uploadXftpWebFile
} from './browser-xftp-web-client.mjs';

const MAX_CONTACT_ID_LENGTH = 160;
const DEFAULT_RECEIVE_LIMIT = 25;
const ATTACHMENT_MARKER = 'simplex-web-file:v1:';
const ATTACHMENT_CHUNK_MARKER = 'simplex-web-file-chunk:v1:';
const DEFAULT_NATIVE_INLINE_FILE_BYTES = 900 * 1024;
const DEFAULT_NATIVE_INLINE_CHUNK_BYTES = 9000;

export class SimplexWebTransportAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SimplexWebTransportAdapterError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new SimplexWebTransportAdapterError(code, message);
}

function safeContactId(value) {
  var id = String(value == null ? '' : value).trim();
  if (!id || id.length > MAX_CONTACT_ID_LENGTH || /[^A-Za-z0-9_.:-]/.test(id)) {
    fail('SIMPLEX_WEB_ADAPTER_CONTACT', 'contact id is required and must be filename-safe ASCII');
  }
  return id;
}

function contactLinkText(message = {}) {
  return String(message.contact_link || message.contactLink || message.invitation_uri || message.invitationUri || '').trim();
}

function parseOptionalContactLink(message = {}) {
  var linkText = contactLinkText(message);
  return linkText ? parseSimplexConnectionLink(linkText) : null;
}

function contactState(contacts, id) {
  if (!contacts || typeof contacts.listContacts !== 'function') return '';
  var rows = contacts.listContacts() || [];
  var found = rows.find((contact) => contact && String(contact.id || '') === id);
  return found ? String(found.state || '') : '';
}

function contactRecord(contacts, id) {
  if (!contacts || typeof contacts.listContacts !== 'function') return null;
  var rows = contacts.listContacts() || [];
  return rows.find((contact) => contact && String(contact.id || '') === id) || null;
}

function nativeContactIdForLink(contacts, contactId, parsedLink) {
  if (!parsedLink || !parsedLink.nativeAgentProfile || contactState(contacts, contactId) !== 'active') {
    return contactId;
  }
  var contact = contactRecord(contacts, contactId);
  if (!contact || contact.nativeAgentProfile) {
    return contactId;
  }
  return contactId.endsWith(':native') ? contactId : safeContactId(contactId + ':native');
}

function rejectUnsupportedNativeContactLink(message = {}) {
  var linkText = String(message.contact_link || message.contactLink || message.invitation_uri || message.invitationUri || '').trim();
  if (!linkText) return null;
  var parsed = parseSimplexConnectionLink(linkText);
  if (parsed.nativeAgentProfile) {
    fail(
      'SIMPLEX_WEB_ADAPTER_NATIVE_AGENT_UNSUPPORTED',
      'native SimpleX Chat invitation links are only accepted by contact request sends'
    );
  }
  return parsed;
}

function safeMessageRef(value, fallback = '') {
  var ref = String(value == null ? fallback : value).trim();
  if (!ref || ref.length > 256 || /[^A-Za-z0-9_.:-]/.test(ref)) {
    fail('SIMPLEX_WEB_ADAPTER_MESSAGE_REF', 'message ref is required and must be filename-safe ASCII');
  }
  return ref;
}

function optionalSafeMessageRef(value) {
  try {
    return safeMessageRef(value);
  } catch (_error) {
    return '';
  }
}

function safeText(value) {
  var text = String(value == null ? '' : value);
  if (!text.trim()) fail('SIMPLEX_WEB_ADAPTER_TEXT', 'message text is required');
  return text;
}

function decodeConfigBytes(value, label) {
  if (value == null || value === '') return new Uint8Array();
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return toBytes(value, label);
  var text = String(value).trim();
  if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) return hexToBytes(text);
  return decodeBase64Url(text, label);
}

function normalizeLocalProfile(profile) {
  var input = profile && typeof profile === 'object' ? profile : {};
  var displayName = String(input.displayName || input.display_name || '').trim().slice(0, 64);
  var fullName = String(input.fullName || input.full_name || displayName).trim().slice(0, 160);
  var out = {};
  if (displayName) out.displayName = displayName;
  if (fullName) out.fullName = fullName;
  return out;
}

function hasProfile(profile) {
  return !!(profile && typeof profile === 'object' && (profile.displayName || profile.display_name || profile.fullName || profile.full_name));
}

function generatedMessageRef(prefix) {
  var random = Math.random().toString(36).slice(2);
  return prefix + '-' + Date.now().toString(36) + '-' + random;
}

async function readFileBytes(file, maxBytes) {
  if (file instanceof Uint8Array || file instanceof ArrayBuffer || ArrayBuffer.isView(file)) {
    var bytes = toBytes(file, 'file bytes');
    if (bytes.length > maxBytes) fail('SIMPLEX_WEB_ADAPTER_FILE_SIZE', 'file is larger than the configured maximum');
    return bytes;
  }
  if (!file || typeof file !== 'object') fail('SIMPLEX_WEB_ADAPTER_FILE', 'file object is required');
  var size = Number(file.size || 0);
  if (Number.isFinite(size) && size > maxBytes) fail('SIMPLEX_WEB_ADAPTER_FILE_SIZE', 'file is larger than the configured maximum');
  if (typeof file.arrayBuffer !== 'function') fail('SIMPLEX_WEB_ADAPTER_FILE', 'file must expose arrayBuffer()');
  var bytesFromFile = new Uint8Array(await file.arrayBuffer());
  if (bytesFromFile.length > maxBytes) fail('SIMPLEX_WEB_ADAPTER_FILE_SIZE', 'file is larger than the configured maximum');
  return bytesFromFile;
}

function fileName(file, fallback) {
  return String(file && file.name || fallback || 'file').slice(0, 255);
}

function fileMime(file) {
  return String(file && (file.type || file.mime) || '').slice(0, 128);
}

function bytesToBase64(bytes) {
  var input = toBytes(bytes, 'base64 bytes');
  var binary = '';
  var chunkSize = 0x8000;
  for (var i = 0; i < input.length; i += chunkSize) {
    var chunk = input.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  if (typeof btoa === 'function') return btoa(binary);
  if (typeof Buffer !== 'undefined') return Buffer.from(input).toString('base64');
  fail('SIMPLEX_WEB_ADAPTER_BASE64', 'base64 encoding is not available');
}

function nativeInlineAttachmentText(message, file, bytes, ref) {
  var meta = {
    name: fileName(file, ref),
    mime: fileMime(file) || 'application/octet-stream',
    size: bytes.length
  };
  var metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  // Native SimpleX Chat does not reliably accept the browser direct-file
  // queue yet. For native-agent contacts, small Secure Chat attachments are
  // sent inside the encrypted SimpleX message body so the owner import can
  // render the media immediately without a plaintext server bridge.
  return String(message.text || '').trimEnd() + '\n\n' + ATTACHMENT_MARKER + encodeBase64Url(metaBytes) + ':' + bytesToBase64(bytes);
}

function nativeInlineAttachmentChunks(message, file, bytes, ref, chunkBytes) {
  var size = Math.max(1, Math.floor(Number(chunkBytes || DEFAULT_NATIVE_INLINE_CHUNK_BYTES) || DEFAULT_NATIVE_INLINE_CHUNK_BYTES));
  var total = Math.max(1, Math.ceil(bytes.length / size));
  var chunks = [];
  var meta = {
    id: ref,
    name: fileName(file, ref),
    mime: fileMime(file) || 'application/octet-stream',
    size: bytes.length,
    total
  };
  var metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  var metaText = encodeBase64Url(metaBytes);
  for (var i = 0; i < total; i += 1) {
    var part = bytes.subarray(i * size, Math.min(bytes.length, (i + 1) * size));
    var prefix = i === 0 ? String(message.text || '').trimEnd() + '\n\n' : '';
    chunks.push(prefix + ATTACHMENT_CHUNK_MARKER + metaText + ':' + String(i + 1) + ':' + String(total) + ':' + bytesToBase64(part));
  }
  return chunks;
}

function timeoutError(error) {
  return error && (
    error.code === 'SIMPLEX_CLIENT_TIMEOUT' ||
    error.code === 'SIMPLEX_SMP_WS_TIMEOUT'
  );
}

function staleNativeContactError(error) {
  if (!error) return false;
  var code = String(error.code || '');
  var message = String(error.message || '');
  var detail = error.detail || error.cause || null;
  var detailText = '';
  try {
    detailText = detail ? JSON.stringify(detail) : '';
  } catch (_err) {
    detailText = String(detail || '');
  }
  return code === 'SIMPLEX_CLIENT_BROKER_ERR' && /\b(AUTH|NO_AUTH)\b/i.test(message + ' ' + detailText);
}

function statusTimeoutMs(message = {}) {
  var ms = Number(message.status_timeout_ms || message.statusTimeoutMs || 0);
  return Number.isFinite(ms) && ms > 0 ? Math.min(120000, Math.floor(ms)) : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))));
}

function makeReceipt(ref, status = 'sent') {
  return {
    accepted: true,
    transport_status: status,
    message_ref: ref
  };
}

function hasConfiguredXftpClient(adapter, contacts) {
  return !!(
    adapter.xftpWebClient ||
    adapter.options.xftpClient ||
    adapter.options.xftp ||
    adapter.options.xftpWebUrl ||
    adapter.options.xftp_web_url ||
    (contacts && contacts.xftpClient)
  );
}

function hasConfiguredXftpOptions(adapter) {
  return !!(
    adapter.xftpWebClient ||
    adapter.options.xftpClient ||
    adapter.options.xftp ||
    adapter.options.xftpWebUrl ||
    adapter.options.xftp_web_url
  );
}

function receivedToFacadeMessage(received) {
  var ref = received && received.msgId ? 'rcv:' + encodeBase64Url(received.msgId) : generatedMessageRef('rcv');
  var file = received && received.file ? received.file : null;
  var payload = received && received.payload && typeof received.payload === 'object' ? received.payload : {};
  return {
    direction: 'incoming',
    message_ref: ref,
    sender_message_ref: payload.messageRef || '',
    message_kind: file ? 'file' : 'text',
    delivery_status: 'received',
    ack_pending: !!(received && received.ackPending),
    ack_error: received && received.ackError ? String(received.ackError).slice(0, 500) : '',
    created_at: received && received.timestamp ? String(received.timestamp) : new Date().toISOString(),
    text: received && received.text ? received.text : '',
    attachment: file ? {
      name: String(file.name || file.fileName || ''),
      mime: String(file.mime || ''),
      size: Number(file.size || 0) || 0
    } : null
  };
}

function createXftpWebFileTransferClient(xftpWebClient) {
  return {
    async uploadFile(bytes, options = {}) {
      var uploaded = await uploadXftpWebFile(xftpWebClient, bytes, {
        fileName: options.name || 'file',
        fileExtra: options.mime || null,
        key: options.rootKey || options.fileRootKey,
        nonce: options.nonce,
        serverAddress: options.serverAddress
      });
      var manifest = {
        ...uploaded.recipientDescription,
        key: undefined,
        fileName: uploaded.recipientDescription.fileName,
        mime: options.mime || ''
      };
      delete manifest.key;
      return {
        manifest,
        rootKey: uploaded.recipientDescription.key,
        uploadedChunks: uploaded.recipientDescription.chunks.length,
        senderDescription: uploaded.senderDescription
      };
    },
    async downloadFile(manifest, rootKey, options = {}) {
      var downloaded = await downloadXftpWebFile(xftpWebClient, {
        ...(manifest || {}),
        key: rootKey
      }, options);
      return downloaded.content;
    }
  };
}

function normalizeAdapterOptions(options, params) {
  return {
    ...(options || {}),
    ...(params && typeof params === 'object' ? params : {})
  };
}

export function createSimplexWebTransportAdapter(options = {}) {
  return new SimplexWebTransportAdapter(options);
}

function attachTransportServer(transport, server) {
  if (transport && server) transport.server = transport.server || server;
  return transport;
}

export class SimplexWebTransportAdapter {
  constructor(options = {}) {
    this.options = options;
    this.transport = options.transport || null;
    this.xftpWebClient = options.xftpWebClient || null;
    this.simplexClient = options.client || null;
    this.store = options.store || null;
    this.contactClient = options.contactClient || null;
    this.injectedContactClient = !!options.contactClient;
    this.history = [];
    this.receipts = new Map();
    this.connected = !!this.contactClient;
    this.profile = normalizeLocalProfile(options.profile || {});
  }

  async connect(params = {}) {
    var config = normalizeAdapterOptions(this.options, params);
    if (!this.transport && !this.contactClient) {
      var smp = config.smp || {};
      var url = config.smpWebSocketUrl || config.smp_url || smp.url;
      if (!url) fail('SIMPLEX_WEB_ADAPTER_SMP', 'SMP WebSocket URL is required');
      this.transport = attachTransportServer(await connectBrowserSmpWebSocketTransport({
        ...smp,
        url,
        keyHash: decodeConfigBytes(config.smpKeyHash || config.smp_key_hash || smp.keyHash, 'SMP key hash')
      }), config.smpServer || smp.server || null);
    }

    if (!config.skipXftp && !config.skip_xftp && !this.xftpWebClient && (config.xftp || config.xftpWebUrl || config.xftp_web_url)) {
      var xftp = config.xftp || {};
      this.xftpWebClient = await connectBrowserXftpWebClient({
        ...xftp,
        url: config.xftpWebUrl || config.xftp_web_url || xftp.url,
        keyHash: decodeConfigBytes(config.xftpKeyHash || config.xftp_key_hash || xftp.keyHash, 'XFTP key hash')
      });
    }

    this.simplexClient = this.simplexClient || config.client || createBrowserSimplexClient({
      ...config,
      server: config.server || config.smpServer || (config.smp && config.smp.server) || (this.transport && this.transport.server) || null,
      transport: this.transport,
      transportForServer: config.transportForServer || (typeof config.smpWebSocketUrlForServer === 'function'
        ? async (server) => {
            var url = await config.smpWebSocketUrlForServer(server);
            return attachTransportServer(await connectBrowserSmpWebSocketTransport({
              ...(config.smp || {}),
              url,
              keyHash: toBytes(server.keyHash || new Uint8Array(), 'SMP server key hash')
            }), server);
          }
        : null)
    });
    this.store = this.store || config.store || createBrowserSimplexStore({
      ...(config.storeOptions || {}),
      namespace: config.namespace || (config.storeOptions && config.storeOptions.namespace) || 'simplex-web'
    });
    if (hasProfile(config.profile)) this.setProfile(config.profile);
    var xftpClient = config.xftpClient || (this.xftpWebClient ? createXftpWebFileTransferClient(this.xftpWebClient) : null);
    this.contactClient = this.contactClient || config.contactClient || createBrowserSimplexContactClient({
      ...config,
      client: this.simplexClient,
      store: this.store,
      xftpClient
    });
    this.connected = true;
    return this.getStatus();
  }

  async ensureReady(params = {}) {
    if (!this.contactClient) await this.connect(params);
    if (!this.contactClient) fail('SIMPLEX_WEB_ADAPTER_CONNECT', 'browser SimpleX contact client is not connected');
    return this.contactClient;
  }

  setProfile(profile = {}) {
    this.profile = normalizeLocalProfile(profile);
    if (this.store && typeof this.store.saveProfile === 'function') this.store.saveProfile(this.profile);
    return this.profile;
  }

  getProfile() {
    if (this.store && typeof this.store.loadProfile === 'function') {
      var stored = normalizeLocalProfile(this.store.loadProfile());
      if (hasProfile(stored)) {
        this.profile = stored;
        return stored;
      }
    }
    return normalizeLocalProfile(this.profile || {});
  }

  messageProfile(message = {}) {
    return hasProfile(message.profile) ? normalizeLocalProfile(message.profile) : this.getProfile();
  }

  getStatus() {
    var transportStatus = this.transport && typeof this.transport.getStatus === 'function'
      ? this.transport.getStatus()
      : null;
    var hasXftp = hasConfiguredXftpClient(this, this.contactClient);
    return {
      transport_status: this.connected ? 'direct-browser-smp' : 'configured',
      transport_error: '',
      connected: this.connected,
      plaintextBridge: false,
      browserNativeProtocol: true,
      xftp_status: hasXftp ? 'configured' : 'missing',
      fileTransferReady: hasXftp,
      contactCount: this.contactClient && typeof this.contactClient.listContacts === 'function'
        ? this.contactClient.listContacts().length
        : 0,
      transport: transportStatus
    };
  }

  async waitForContactAccept(contacts, contactId, message = {}) {
    var timeoutMs = statusTimeoutMs(message);
    if (!timeoutMs) return false;
    var deadline = Date.now() + timeoutMs;
    var attempt = 0;
    while (Date.now() < deadline) {
      var remaining = deadline - Date.now();
      try {
        await contacts.receiveContactAccept(contactId, {
          ...message,
          corrId: message.accept_corr_id || message.acceptCorrId || message.status_corr_id || message.statusCorrId || ('accept-' + Date.now().toString(36) + '-' + attempt),
          timeoutMs: Math.max(250, Math.min(Number(message.accept_timeout_ms || message.acceptTimeoutMs || 5000) || 5000, remaining))
        });
        return true;
      } catch (error) {
        if (!timeoutError(error)) throw error;
        await sleep(Math.min(500, Math.max(50, deadline - Date.now())));
      }
      attempt += 1;
    }
    return false;
  }

  async sendText(message = {}) {
    var linkText = contactLinkText(message);
    var parsedLink = parseOptionalContactLink(message);
    var contacts = await this.ensureReady(parsedLink && parsedLink.nativeAgentProfile ? { skipXftp: true } : {});
    var contactId = safeContactId(message.contact_id || message.contactId || this.options.defaultContactId);
    var text = safeText(message.text);
    var ref = String(message.client_message_id || message.clientMessageId || message.message_ref || generatedMessageRef('snd'));
    contactId = nativeContactIdForLink(contacts, contactId, parsedLink);
    if (parsedLink && parsedLink.nativeAgentProfile && contactState(contacts, contactId) !== 'active') {
      try {
        await contacts.requestContact(contactId, linkText, {
          ...message,
          allowNativeAgentProfile: true,
          corrId: message.contact_corr_id || message.contactCorrId || message.corr_id || message.corrId,
          profile: this.messageProfile(message)
        });
      } catch (error) {
        if (!timeoutError(error)) throw error;
      }
      if (await this.waitForContactAccept(contacts, contactId, message)) {
        await contacts.sendText(contactId, text, {
          clientMessageId: ref,
          corrId: message.send_corr_id || message.sendCorrId || message.corr_id || message.corrId,
          timeoutMs: message.timeout_ms || message.timeoutMs
        });
        var sentAfterAccept = makeReceipt(ref, 'sent');
        this.receipts.set(ref, sentAfterAccept);
        this.history.push({
          direction: 'outgoing',
          message_ref: ref,
          message_kind: 'text',
          delivery_status: 'sent',
          created_at: new Date().toISOString(),
          text
        });
        return sentAfterAccept;
      }
      var requested = {
        ...makeReceipt(ref, 'contact-requested'),
        delivery_status: 'contact-requested',
        contact_state: 'requested'
      };
      this.receipts.set(ref, requested);
      this.history.push({
        direction: 'outgoing',
        message_ref: ref,
        message_kind: 'text',
        delivery_status: 'contact-requested',
        created_at: new Date().toISOString(),
        text
      });
      return requested;
    }
    try {
      await contacts.sendText(contactId, text, {
        clientMessageId: ref,
        corrId: message.corr_id || message.corrId,
        timeoutMs: message.timeout_ms || message.timeoutMs
      });
    } catch (error) {
      if (!(parsedLink && parsedLink.nativeAgentProfile && staleNativeContactError(error))) throw error;
      if (typeof contacts.deleteContact === 'function') contacts.deleteContact(contactId, { hardDelete: true, localOnly: true });
      try {
        await contacts.requestContact(contactId, linkText, {
          ...message,
          allowNativeAgentProfile: true,
          corrId: message.contact_corr_id || message.contactCorrId || message.corr_id || message.corrId,
          profile: this.messageProfile(message)
        });
      } catch (requestError) {
        if (!timeoutError(requestError)) throw requestError;
      }
      var reRequested = {
        ...makeReceipt(ref, 'contact-requested'),
        delivery_status: 'contact-requested',
        contact_state: 'requested'
      };
      this.receipts.set(ref, reRequested);
      this.history.push({
        direction: 'outgoing',
        message_ref: ref,
        message_kind: 'text',
        delivery_status: 'contact-requested',
        created_at: new Date().toISOString(),
        text
      });
      return reRequested;
    }
    var receipt = makeReceipt(ref, 'sent');
    this.receipts.set(ref, receipt);
    this.history.push({
      direction: 'outgoing',
      message_ref: ref,
      message_kind: 'text',
      delivery_status: 'sent',
      created_at: new Date().toISOString(),
      text
    });
    return receipt;
  }

  async sendFiles(message = {}) {
    var linkText = contactLinkText(message);
    if (!linkText && !this.injectedContactClient && !hasConfiguredXftpOptions(this)) {
      fail(
        'SIMPLEX_WEB_ADAPTER_XFTP',
        'browser-native SimpleX file sending requires a configured XFTP web endpoint'
      );
    }
    var parsedLink = null;
    try {
      parsedLink = parseOptionalContactLink(message);
    } catch (error) {
      if (!hasConfiguredXftpOptions(this)) {
        fail(
          'SIMPLEX_WEB_ADAPTER_XFTP',
          'browser-native SimpleX file sending requires a configured XFTP web endpoint'
        );
      }
      throw error;
    }
    var nativeDirectFile = !!(parsedLink && parsedLink.nativeAgentProfile);
    var contacts = await this.ensureReady(nativeDirectFile ? { skipXftp: true } : {});
    var contactId = safeContactId(message.contact_id || message.contactId || this.options.defaultContactId);
    contactId = nativeContactIdForLink(contacts, contactId, parsedLink);
    if (contactState(contacts, contactId) === 'active') {
      var activeContact = contactRecord(contacts, contactId);
      nativeDirectFile = nativeDirectFile || !!(activeContact && activeContact.nativeAgentProfile);
    }
    if (!nativeDirectFile && !this.injectedContactClient && !hasConfiguredXftpClient(this, contacts)) {
      fail(
        'SIMPLEX_WEB_ADAPTER_XFTP',
        'browser-native SimpleX file sending requires a configured XFTP web endpoint'
      );
    }
    if (parsedLink && parsedLink.nativeAgentProfile && contactState(contacts, contactId) !== 'active') {
      try {
        await contacts.requestContact(contactId, linkText, {
          ...message,
          allowNativeAgentProfile: true,
          corrId: message.contact_corr_id || message.contactCorrId || message.corr_id || message.corrId,
          profile: this.messageProfile(message)
        });
      } catch (error) {
        if (!timeoutError(error)) throw error;
      }
      var pendingRef = String(message.client_message_id || message.clientMessageId || generatedMessageRef('file'));
      if (await this.waitForContactAccept(contacts, contactId, message)) {
        message = { ...message, client_message_id: pendingRef };
      } else {
        var pending = {
          ...makeReceipt(pendingRef, 'contact-requested'),
          delivery_status: 'contact-requested',
          contact_state: 'requested'
        };
        this.receipts.set(pendingRef, pending);
        return [pending];
      }
    }
    var files = Array.isArray(message.files) ? message.files : Array.from(message.files || []);
    if (!files.length) fail('SIMPLEX_WEB_ADAPTER_FILE', 'at least one file is required');
    var maxBytes = Math.max(1, Math.floor(Number(message.max_file_bytes || message.maxFileBytes || this.options.maxFileBytes || (25 * 1024 * 1024)) || (25 * 1024 * 1024)));
    var maxNativeInlineBytes = Math.max(1, Math.floor(Number(message.max_native_inline_file_bytes || message.maxNativeInlineFileBytes || this.options.maxNativeInlineFileBytes || DEFAULT_NATIVE_INLINE_FILE_BYTES) || DEFAULT_NATIVE_INLINE_FILE_BYTES));
    var nativeInlineChunkBytes = Math.max(1, Math.floor(Number(message.native_inline_chunk_bytes || message.nativeInlineChunkBytes || this.options.nativeInlineChunkBytes || DEFAULT_NATIVE_INLINE_CHUNK_BYTES) || DEFAULT_NATIVE_INLINE_CHUNK_BYTES));
    var receipts = [];
    for (var i = 0; i < files.length; i += 1) {
      var file = files[i];
      var ref = String(message.client_message_id || message.clientMessageId || generatedMessageRef('file')) + (files.length > 1 ? '-' + i : '');
      var bytes = await readFileBytes(file, maxBytes);
      var sent;
      if (nativeDirectFile) {
        if (bytes.length > maxNativeInlineBytes) {
          fail('SIMPLEX_WEB_ADAPTER_NATIVE_INLINE_FILE_SIZE', 'browser-native SimpleX attachment is too large for inline encrypted delivery');
        }
        if (bytes.length <= nativeInlineChunkBytes) {
          sent = await contacts.sendText(contactId, nativeInlineAttachmentText(message, file, bytes, ref), {
            clientMessageId: ref,
            timeoutMs: message.timeout_ms || message.timeoutMs
          });
        } else {
          var chunkTexts = nativeInlineAttachmentChunks(message, file, bytes, ref, nativeInlineChunkBytes);
          for (var chunkIndex = 0; chunkIndex < chunkTexts.length; chunkIndex += 1) {
            sent = await contacts.sendText(contactId, chunkTexts[chunkIndex], {
              clientMessageId: ref + ':chunk:' + String(chunkIndex + 1),
              timeoutMs: message.timeout_ms || message.timeoutMs
            });
          }
        }
      } else {
        sent = await contacts.sendFile(contactId, bytes, {
          clientMessageId: ref,
          name: fileName(file, ref),
          mime: fileMime(file),
          timeoutMs: message.timeout_ms || message.timeoutMs
        });
      }
      var nativeTransferPending = sent && ((sent.nativeDirectFile && sent.nativeDirectFile.completed !== true) || sent.queued);
      var receipt = {
        ...makeReceipt(ref, nativeTransferPending ? 'sending' : 'sent'),
        delivery_status: nativeTransferPending ? 'sending' : 'sent',
        attachment: {
          name: fileName(file, ref),
          mime: fileMime(file),
          size: bytes.length
        },
        file: nativeDirectFile ? { inlineAttachment: true, fileName: fileName(file, ref), fileSize: bytes.length } : sent.file
      };
      this.receipts.set(ref, receipt);
      this.history.push({
        direction: 'outgoing',
        message_ref: ref,
        message_kind: 'file',
        delivery_status: receipt.delivery_status,
        created_at: new Date().toISOString(),
        text: '',
        attachment: receipt.attachment
      });
      receipts.push(receipt);
    }
    return receipts;
  }

  async getMessages(query = {}) {
    rejectUnsupportedNativeContactLink(query);
    var contacts = await this.ensureReady();
    var contactId = safeContactId(query.contact_id || query.contactId || this.options.defaultContactId);
    var limit = Math.max(1, Math.min(200, Math.floor(Number(query.limit || query.count || DEFAULT_RECEIVE_LIMIT) || DEFAULT_RECEIVE_LIMIT)));
    var messages = [];
    for (var i = 0; i < limit; i += 1) {
      try {
        var received = await contacts.receiveNext(contactId, {
          timeoutMs: query.timeout_ms || query.timeoutMs || this.options.receiveTimeoutMs || 100,
          acknowledge: query.acknowledge !== false,
          subscribeBeforeReceive: query.subscribe_before_receive !== false && query.subscribeBeforeReceive !== false,
          subscribeCorrId: query.subscribe_corr_id || query.subscribeCorrId
        });
        if (received && received.duplicate) continue;
        if (received && received.payload && received.payload.type === 'read-receipt') {
          var readRef = optionalSafeMessageRef(received.payload.messageRef);
          if (readRef) {
            this.receipts.set(readRef, {
              ...makeReceipt(readRef, 'read'),
              read_at: received.payload.readAt || new Date().toISOString()
            });
          }
          continue;
        }
        var facadeMessage = receivedToFacadeMessage(received);
        messages.push(facadeMessage);
        this.history.push(facadeMessage);
        var senderMessageRef = facadeMessage.sender_message_ref;
        if (senderMessageRef && query.send_read_receipts !== false && query.sendReadReceipts !== false && this.options.sendReadReceipts !== false) {
          try {
            await this.sendReadReceipt({
              contact_id: contactId,
              message_ref: senderMessageRef,
              corr_id: query.read_receipt_corr_id || query.readReceiptCorrId
            });
          } catch (error) {
            facadeMessage.read_receipt_error = String(error && error.message || error || '').slice(0, 500);
          }
        }
      } catch (error) {
        if (timeoutError(error)) break;
        throw error;
      }
    }
    return messages;
  }

  async getMessageStatus(message = {}) {
    var ref = safeMessageRef(message.message_ref || message.messageRef || message.client_message_id || message.clientMessageId);
    return this.receipts.get(ref) || makeReceipt(ref, 'unknown');
  }

  async sendReadReceipt(message = {}) {
    rejectUnsupportedNativeContactLink(message);
    var contacts = await this.ensureReady();
    var contactId = safeContactId(message.contact_id || message.contactId || this.options.defaultContactId);
    var readRef = safeMessageRef(message.message_ref || message.messageRef || message.read_message_ref || message.readMessageRef);
    var receiptRef = String(message.client_message_id || message.clientMessageId || generatedMessageRef('read'));
    await contacts.sendReadReceipt(contactId, readRef, {
      clientMessageId: receiptRef,
      corrId: message.corr_id || message.corrId,
      timeoutMs: message.timeout_ms || message.timeoutMs,
      readAt: message.read_at || message.readAt
    });
    var receipt = {
      ...makeReceipt(receiptRef, 'sent'),
      read_message_ref: readRef
    };
    this.receipts.set(receiptRef, receipt);
    return receipt;
  }

  async createInvitation(params = {}) {
    var contacts = await this.ensureReady();
    return contacts.createInvitation({
      ...params,
      id: safeContactId(params.contact_id || params.contactId || params.id || this.options.defaultContactId)
    });
  }

  invitationUri(contactId) {
    if (!this.contactClient) fail('SIMPLEX_WEB_ADAPTER_CONNECT', 'browser SimpleX contact client is not connected');
    return this.contactClient.invitationUri(safeContactId(contactId || this.options.defaultContactId));
  }

  async requestContact(params = {}) {
    var contacts = await this.ensureReady();
    return contacts.requestContact(
      safeContactId(params.contact_id || params.contactId || params.id || this.options.defaultContactId),
      params.invitation_uri || params.invitationUri || params.contact_link || params.contactLink,
      params
    );
  }

  async receiveContactRequest(params = {}) {
    var contacts = await this.ensureReady();
    return contacts.receiveContactRequest(
      safeContactId(params.contact_id || params.contactId || params.id || this.options.defaultContactId),
      params
    );
  }

  async receiveContactAccept(params = {}) {
    var contacts = await this.ensureReady();
    return contacts.receiveContactAccept(
      safeContactId(params.contact_id || params.contactId || params.id || this.options.defaultContactId),
      params
    );
  }

  async deleteContact(params = {}) {
    var contacts = await this.ensureReady();
    var contactId = safeContactId(params.contact_id || params.contactId || params.id || this.options.defaultContactId);
    var options = {
      ...params,
      corrId: params.corr_id || params.corrId,
      hardDelete: params.hard_delete === true || params.hardDelete === true,
      localOnly: params.local_only === true || params.localOnly === true,
      remoteDelete: params.remote_delete === false ? false : params.remoteDelete
    };
    if (options.localOnly === true || options.remoteDelete === false) {
      return contacts.deleteContact(contactId, options);
    }
    if (typeof contacts.deleteContactEverywhere === 'function') {
      return contacts.deleteContactEverywhere(contactId, options);
    }
    return contacts.deleteContact(contactId, options);
  }

  activateContact(params = {}) {
    if (!this.contactClient) fail('SIMPLEX_WEB_ADAPTER_CONNECT', 'browser SimpleX contact client is not connected');
    return this.contactClient.activateContact(
      safeContactId(params.contact_id || params.contactId || params.id || this.options.defaultContactId),
      params
    );
  }

  listContacts() {
    return this.contactClient && typeof this.contactClient.listContacts === 'function'
      ? this.contactClient.listContacts()
      : [];
  }

  drainDueRetries(options = {}) {
    if (!this.contactClient) return Promise.resolve([]);
    return this.contactClient.drainDueRetries(options);
  }

  disconnect() {
    if (this.transport && typeof this.transport.close === 'function') this.transport.close();
    if (this.xftpWebClient && typeof this.xftpWebClient.close === 'function') this.xftpWebClient.close();
    this.connected = false;
    return Promise.resolve();
  }
}

export function registerSimplexWebTransportAdapter(options = {}, facade = globalThis.SimplexWebTransport) {
  var adapter = createSimplexWebTransportAdapter(options);
  if (!facade || typeof facade.registerBrowserTransport !== 'function') {
    fail('SIMPLEX_WEB_ADAPTER_FACADE', 'window.SimplexWebTransport.registerBrowserTransport is not available');
  }
  return facade.registerBrowserTransport(adapter);
}

export default {
  SimplexWebTransportAdapter,
  SimplexWebTransportAdapterError,
  createSimplexWebTransportAdapter,
  registerSimplexWebTransportAdapter
};
