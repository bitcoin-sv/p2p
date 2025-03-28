import { WalletClient, AuthFetch } from '@bsv/sdk'
import { AuthSocketClient } from '@bsv/authsocket-client'
import { Logger } from './Utils/logger.js'

/**
 * Defines the structure of a PeerMessage
 */
export interface PeerMessage {
  messageId: string
  body: string
  sender: string
  created_at: string
  updated_at: string
  acknowledged?: boolean
}

/**
 * Defines the structure of a message being sent
 */
export interface SendMessageParams {
  recipient: string
  messageBox: string
  body: string | object
  messageId?: string
}

/**
 * Defines the structure of the response from sendMessage
 */
export interface SendMessageResponse {
  status: string
  messageId: string
}

/**
 * Defines the structure of a request to acknowledge messages
 */
export interface AcknowledgeMessageParams {
  messageIds: string[]
}

/**
 * Defines the structure of a request to list messages
 */
export interface ListMessagesParams {
  messageBox: string
}

/**
 * Extendable class for interacting with a MessageBoxServer
 */
export class MessageBoxClient {
  private readonly host: string
  public readonly authFetch: AuthFetch
  private readonly walletClient: WalletClient
  private socket?: ReturnType<typeof AuthSocketClient>
  private myIdentityKey?: string

  constructor({
    host = 'https://messagebox.babbage.systems',
    walletClient,
    enableLogging = false
  }: { host?: string, walletClient: WalletClient, enableLogging?: boolean }) {
    this.host = host;
    this.walletClient = walletClient;
    this.authFetch = new AuthFetch(this.walletClient);
  
    // Enable or disable logging based on user preference
    if (enableLogging === true) {
      Logger.enable();
    }
  }
  

  /**
  * Getter for joinedRooms to use in tests
  */
  public getJoinedRooms(): Set<string> {
    return this.joinedRooms
  }

  public getIdentityKey(): string {
    if (this.myIdentityKey == null) {
      throw new Error('[MB CLIENT ERROR] Identity key is not set')
    }
    return this.myIdentityKey
  }

  // Add a getter for testing purposes
  public get testSocket(): ReturnType<typeof AuthSocketClient> | undefined {
    return this.socket
  }

  /**
  * Establish an initial WebSocket connection (optional)
  */
  async initializeConnection(): Promise<void> {
    Logger.log('[MB CLIENT] initializeConnection() STARTED') // 🔹 Confirm function is called

    if (this.myIdentityKey == null || this.myIdentityKey.trim() === '') {
      Logger.log('[MB CLIENT] Fetching identity key...')
      try {
        const keyResult = await this.walletClient.getPublicKey({ identityKey: true })
        this.myIdentityKey = keyResult.publicKey
        Logger.log(`[MB CLIENT] Identity key fetched successfully: ${this.myIdentityKey}`)
      } catch (error) {
        Logger.error('[MB CLIENT ERROR] Failed to fetch identity key:', error)
        throw new Error('Identity key retrieval failed')
      }
    }

    if (this.myIdentityKey == null || this.myIdentityKey.trim() === '') {
      Logger.error('[MB CLIENT ERROR] Identity key is still missing after retrieval!')
      throw new Error('Identity key is missing')
    }

    Logger.log('[MB CLIENT] Setting up WebSocket connection...')

    if (this.socket == null) {
      this.socket = AuthSocketClient(this.host, { wallet: this.walletClient })

      let identitySent = false
      let authenticated = false

      this.socket.on('connect', () => {
        Logger.log('[MB CLIENT] Connected to WebSocket.')

        if (!identitySent) {
          Logger.log('[MB CLIENT] Sending authentication data:', this.myIdentityKey)
          if (this.myIdentityKey == null || this.myIdentityKey.trim() === '') {
            Logger.error('[MB CLIENT ERROR] Cannot send authentication: Identity key is missing!')
          } else {
            this.socket?.emit('authenticated', { identityKey: this.myIdentityKey })
            identitySent = true
          }
        }
      })

      // Listen for authentication success from the server
      this.socket.on('authenticationSuccess', (data) => {
        Logger.log(`[MB CLIENT] WebSocket authentication successful: ${JSON.stringify(data)}`)
        authenticated = true
      })

      // Handle authentication failures
      this.socket.on('authenticationFailed', (data) => {
        Logger.error(`[MB CLIENT ERROR] WebSocket authentication failed: ${JSON.stringify(data)}`)
        authenticated = false
      })

      this.socket.on('disconnect', () => {
        Logger.log('[MB CLIENT] Disconnected from MessageBox server')
        this.socket = undefined
        identitySent = false
        authenticated = false
      })

      this.socket.on('error', (error) => {
        Logger.error('[MB CLIENT ERROR] WebSocket error:', error)
      })

      // Wait for authentication confirmation before proceeding
      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          if (authenticated) {
            Logger.log('[MB CLIENT] WebSocket fully authenticated and ready!')
            resolve()
          } else {
            reject(new Error('[MB CLIENT ERROR] WebSocket authentication timed out!'))
          }
        }, 5000) // Timeout after 5 seconds
      })
    }
  }

  /**
 * Tracks rooms the client has already joined
 */
  private readonly joinedRooms: Set<string> = new Set()

  /**
   * Join a WebSocket room before sending messages
   */
  async joinRoom(messageBox: string): Promise<void> {
    Logger.log(`[MB CLIENT] Attempting to join WebSocket room: ${messageBox}`)

    // Ensure WebSocket connection is established first
    if (this.socket == null) {
      Logger.log('[MB CLIENT] No WebSocket connection. Initializing...')
      await this.initializeConnection()
    }

    if (this.myIdentityKey == null || this.myIdentityKey.trim() === '') {
      throw new Error('[MB CLIENT ERROR] Identity key is not defined')
    }

    const roomId = `${this.myIdentityKey ?? ''}-${messageBox}`

    if (this.joinedRooms.has(roomId)) {
      Logger.log(`[MB CLIENT] Already joined WebSocket room: ${roomId}`)
      return
    }

    try {
      Logger.log(`[MB CLIENT] Joining WebSocket room: ${roomId}`)
      await this.socket?.emit('joinRoom', roomId)
      this.joinedRooms.add(roomId)
      Logger.log(`[MB CLIENT] Successfully joined room: ${roomId}`)
    } catch (error) {
      Logger.error(`[MB CLIENT ERROR] Failed to join WebSocket room: ${roomId}`, error)
    }
  }

  async listenForLiveMessages({
    onMessage,
    messageBox
  }: {
    onMessage: (message: PeerMessage) => void
    messageBox: string
  }): Promise<void> {
    Logger.log(`[MB CLIENT] Setting up listener for WebSocket room: ${messageBox}`)

    // Ensure WebSocket connection and room join
    await this.joinRoom(messageBox)

    // Ensure identity key is available before creating roomId
    if (this.myIdentityKey == null || this.myIdentityKey.trim() === '') {
      throw new Error('[MB CLIENT ERROR] Identity key is missing. Cannot construct room ID.')
    }

    const roomId = `${this.myIdentityKey}-${messageBox}`

    Logger.log(`[MB CLIENT] Listening for messages in room: ${roomId}`)

    this.socket?.on(`sendMessage-${roomId}`, (message: PeerMessage) => {
      Logger.log(`[MB CLIENT] Received message in room ${roomId}:`, message)
      onMessage(message)
    })
  }

  /**
 * Sends a message over WebSocket if connected; falls back to HTTP otherwise.
 */
  async sendLiveMessage({ recipient, messageBox, body }: SendMessageParams): Promise<SendMessageResponse> {
    if (recipient == null || recipient.trim() === '') {
      throw new Error('[MB CLIENT ERROR] Recipient identity key is required')
    }
    if (messageBox == null || messageBox.trim() === '') {
      throw new Error('[MB CLIENT ERROR] MessageBox is required')
    }
    if (body == null || (typeof body === 'string' && body.trim() === '')) {
      throw new Error('[MB CLIENT ERROR] Message body cannot be empty')
    }

    // Ensure WebSocket connection and room join before sending
    await this.joinRoom(messageBox)

    if (this.socket == null || !this.socket.connected) {
      Logger.warn('[MB CLIENT WARNING] WebSocket not connected, falling back to HTTP')
      return await this.sendMessage({ recipient, messageBox, body })
    }

    // Generate message ID
    let messageId: string
    try {
      const hmac = await this.walletClient.createHmac({
        data: Array.from(new TextEncoder().encode(JSON.stringify(body))),
        protocolID: [0, 'messagebox'],
        keyID: '1',
        counterparty: recipient
      })
      messageId = Array.from(hmac.hmac).map(b => b.toString(16).padStart(2, '0')).join('')
    } catch (error) {
      Logger.error('[MB CLIENT ERROR] Failed to generate HMAC:', error)
      throw new Error('Failed to generate message identifier.')
    }

    const roomId = `${recipient}-${messageBox}`
    Logger.log(`[MB CLIENT] Sending WebSocket message to room: ${roomId}`)

    return await new Promise((resolve, reject) => {
      const ackEvent = `sendMessageAck-${roomId}`
      let handled = false
    
      const ackHandler = (response?: SendMessageResponse): void => {
        if (handled) return
        handled = true
    
        const socketAny = this.socket as any
        if (typeof socketAny?.off === 'function') {
          socketAny.off(ackEvent, ackHandler)
        }
    
        Logger.log('[MB CLIENT] Received WebSocket acknowledgment:', response)
    
        if (response == null || response.status !== 'success') {
          Logger.warn('[MB CLIENT] WebSocket message failed, falling back to HTTP')
          this.sendMessage({ recipient, messageBox, body }).then(resolve).catch(reject)
        } else {
          Logger.log('[MB CLIENT] Message sent successfully via WebSocket:', response)
          resolve(response)
        }
      }
    
      // Register listener before emitting
      this.socket?.on(ackEvent, ackHandler)
    
      // Send the message
      this.socket?.emit('sendMessage', {
        roomId,
        message: {
          messageId,
          recipient,
          body: typeof body === 'string' ? body : JSON.stringify(body)
        }
      })
    
      // Timeout fallback after 10 seconds
      setTimeout(() => {
        if (!handled) {
          handled = true
          const socketAny = this.socket as any
          if (typeof socketAny?.off === 'function') {
            socketAny.off(ackEvent, ackHandler) // 🧹 Clean up listener
          }
          Logger.warn('[CLIENT] WebSocket acknowledgment timed out, falling back to HTTP')
          this.sendMessage({ recipient, messageBox, body }).then(resolve).catch(reject)
        }
      }, 10000)
    })
  }

  /**
   * Leaves a WebSocket room.
   */
  async leaveRoom(messageBox: string): Promise<void> {
    if (this.socket == null) {
      Logger.warn('[MB CLIENT] Attempted to leave a room but WebSocket is not connected.')
      return
    }

    if (this.myIdentityKey == null || this.myIdentityKey.trim() === '') {
      throw new Error('[MB CLIENT ERROR] Identity key is not defined')
    }

    const roomId = `${this.myIdentityKey}-${messageBox}`
    Logger.log(`[MB CLIENT] Leaving WebSocket room: ${roomId}`)
    this.socket.emit('leaveRoom', roomId)

    // Ensure the room is removed from tracking
    this.joinedRooms.delete(roomId)
  }

  /**
   * Closes WebSocket connection.
   */
  async disconnectWebSocket(): Promise<void> {
    if (this.socket != null) {
      Logger.log('[MB CLIENT] Closing WebSocket connection...')
      this.socket.disconnect()
      this.socket = undefined
    } else {
      Logger.log('[MB CLIENT] No active WebSocket connection to close.')
    }
  }

  /**
   * Sends a message via HTTP
   */
  async sendMessage(message: SendMessageParams): Promise<SendMessageResponse> {
    if (message.recipient == null || message.recipient.trim() === '') {
      throw new Error('You must provide a message recipient!')
    }
    if (message.messageBox == null || message.messageBox.trim() === '') {
      throw new Error('You must provide a messageBox to send this message into!')
    }
    if (message.body == null || (typeof message.body === 'string' && message.body.trim().length === 0)) {
      throw new Error('Every message must have a body!')
    }

    // Generate HMAC
    let messageId: string
    try {
      const hmac = await this.walletClient.createHmac({
        data: Array.from(new TextEncoder().encode(JSON.stringify(message.body))),
        protocolID: [0, 'messagebox'],
        keyID: '1',
        counterparty: message.recipient
      })
      messageId = message.messageId ?? Array.from(hmac.hmac).map(b => b.toString(16).padStart(2, '0')).join('')
    } catch (error) {
      Logger.error('[MB CLIENT ERROR] Failed to generate HMAC:', error)
      throw new Error('Failed to generate message identifier.')
    }

    const requestBody = {
      message: { ...message, messageId, body: JSON.stringify(message.body) }
    }

    try {
      Logger.log('[MB CLIENT] Sending HTTP request to:', `${this.host}/sendMessage`)
      Logger.log('[MB CLIENT] Request Body:', JSON.stringify(requestBody, null, 2))

      // Ensure the identity key is fetched before sending
      if (this.myIdentityKey == null || this.myIdentityKey === '') {
        try {
          const keyResult = await this.walletClient.getPublicKey({ identityKey: true })
          this.myIdentityKey = keyResult.publicKey
          Logger.log(`[MB CLIENT] Fetched identity key before sending request: ${this.myIdentityKey}`)
        } catch (error) {
          Logger.error('[MB CLIENT ERROR] Failed to fetch identity key:', error)
          throw new Error('Identity key retrieval failed')
        }
      }

      // Now create the headers AFTER ensuring identityKey is set
      const authHeaders = {
        'Content-Type': 'application/json'
      }

      Logger.log('[MB CLIENT] Sending Headers:', JSON.stringify(authHeaders, null, 2))

      const response = await this.authFetch.fetch(`${this.host}/sendMessage`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(requestBody)
      })

      // Debug: Check if bodyUsed before reading
      Logger.log('[MB CLIENT] Raw Response:', response)
      Logger.log('[MB CLIENT] Response Body Used?', response.bodyUsed)

      // Read body only if it's not already consumed
      if (response.bodyUsed) {
        throw new Error('[MB CLIENT ERROR] Response body has already been used!')
      }

      const parsedResponse = await response.json()
      Logger.log('[MB CLIENT] Raw Response Body:', parsedResponse)

      if (!response.ok) {
        Logger.error(`[MB CLIENT ERROR] Failed to send message. HTTP ${response.status}: ${response.statusText}`)
        throw new Error(`Message sending failed: HTTP ${response.status} - ${response.statusText}`)
      }

      if (parsedResponse.status !== 'success') {
        Logger.error(`[MB CLIENT ERROR] Server returned an error: ${String(parsedResponse.description)}`)
        throw new Error(parsedResponse.description ?? 'Unknown error from server.')
      }

      Logger.log('[MB CLIENT] Message successfully sent.')
      return { ...parsedResponse, messageId }
    } catch (error) {
      Logger.error('[MB CLIENT ERROR] Network or timeout error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to send message: ${errorMessage}`)
    }
  }

  /**
   * Lists messages from MessageBoxServer
   */
  async listMessages({ messageBox }: ListMessagesParams): Promise<PeerMessage[]> {
    if (messageBox.trim() === '') {
      throw new Error('MessageBox cannot be empty')
    }

    const response = await this.authFetch.fetch(`${this.host}/listMessages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageBox })
    })

    const parsedResponse = await response.json()

    if (parsedResponse.status === 'error') {
      throw new Error(parsedResponse.description)
    }

    return parsedResponse.messages
  }

  /**
   * Acknowledges one or more messages as having been received
   */
  async acknowledgeMessage({ messageIds }: AcknowledgeMessageParams): Promise<string> {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      throw new Error('Message IDs array cannot be empty')
    }

    Logger.log(`[MB CLIENT] Acknowledging messages: ${JSON.stringify(messageIds)}`)

    const acknowledged = await this.authFetch.fetch(`${this.host}/acknowledgeMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageIds })
    })

    const parsedAcknowledged = await acknowledged.json()

    if (parsedAcknowledged.status === 'error') {
      throw new Error(parsedAcknowledged.description)
    }

    return parsedAcknowledged.status
  }
}
