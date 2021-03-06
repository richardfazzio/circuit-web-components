const template = document.createElement('template');
template.innerHTML = `
<style>
#conversationList {
  overflow-y: auto;
  min-width: var(--min-width);
  max-height: var(--max-height);
}
.circuit-conversation {
  display: flex;
  align-items: center;
  font-family: var(--conversation-font);
  font-size: var(--conversation-font-size);
  height: var(--conversation-height);
  border: var(--conversation-border);
  padding: var(--conversation-padding);
}
</style>
<select class="select-wide" 
        id="conversationList">
</select>`;
export class CircuitConversationsList extends HTMLElement {

  set client(client) {
    if (!client || (this._client && this._client.loggedOnUser && client.loggedOnUser.userId === this._client.loggedOnUser.userId)) {
      return;
    }
    this._client = client;
  }

  set _connected(isConnected) {
    if (isConnected) {
      this.setAttribute('connected', '');
    } else {
      this.removeAttribute('connected');
    }
  }

  get connected() {
    return this.hasAttribute('connected');
  }

  get client() {
    return this._client;
  }

  get conversations() {
    return this._conversationsList;
  }

  get users() {
    return this._directUsers;
  }

  constructor() {
    super();
    this._client = null;

    this.root = this.attachShadow({ mode: 'open' });
    this.root.appendChild(template.content.cloneNode(true));

    this._usersHashMap = {}; // Hashmap to store users names for the conversation feed
    this._conversationsListElement = this.root.getElementById('conversationList'); // Conversation List Container
    this._conversationsListElement.size = !!this.getAttribute('size') && Number(this.getAttribute('size')) || 5;
  }

  // Delay Circuit initialization to speed up page load. This way the SDK
  // can be loaded with 'async'
  async _init() {
    Circuit.logger.setLevel(1);
    this._client = Circuit.Client({
      domain: this._domain,
      client_id: this._clientId
    });

    // Event listeners

    this._conversationsListElement.addEventListener('change', evt => {
      const convId = evt.target.value;
      const conversation = this._conversationsList.find(c => c.convId === convId);
      this.dispatchEvent(new CustomEvent('selected', { 
        detail: {
          client: this._client,
          conversation: conversation
        }
      }));
    });

    this._client.addEventListener('conversationUpdated', evt => {
      const conversation = evt.conversation;
      const index = this._conversationsList.findIndex(c => c.convId === conversation.convId);
      if (index > -1 && conversation.type !== Circuit.Enums.ConversationType.DIRECT) {
        this._conversationsList[index] = conversation;
        const element = this.root.getElementById(conversation.convId);
        element.innerHTML = conversation.topic || conversation.topicPlaceholder;
        this.dispatchEvent(new CustomEvent('conversationUpdated', {
          detail: {
            conversation: conversation
          }
        }));
      }
    });

    // If a new conversation is created, update the list
    this._client.addEventListener('conversationCreated', evt => {
      const conversation = evt.conversation;
      const newConversationElm = this._createConversationHtml(conversation);
      this._conversationsList = [conversation, ...this._conversationsList];
      this._conversationsListElement.insertBefore(newConversationElm, this._conversationsListElement.firstChild);
      this.dispatchEvent(new CustomEvent('conversationCreated', {
        detail: {
          conversation: conversation
        }
      }));
    });

    this.dispatchEvent(new CustomEvent('initialized', { detail: this.client }));
  }

  async _connect() {
    if (!Circuit) {
      throw Error('circuit-sdk is not loaded');
    }
    !this._client && this._init();

    try {
      if (this._client.connectionState === 'Connected') {
        return;
      } else if (this._client.connectionState === 'Disconnected') {
          await this._client.logon();
      } else {
        await this._waitForConnected(5000);
      }
    } catch (err) {
      console.error('Error connecting to Circuit', err);
      throw new Error('Error connecting to Circuit');
    }
  }

  async _waitForConnected(timeoutms) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this._client.connectionState === 'Connected') {
          resolve();
        } else if ((timeoutms -= 100) < 0) {
          reject('timed out');
        } else {
          setTimeout(check, 100);
        }
      }
      setTimeout(check, 100);
    });
  }

  async _getConversations() {
    try {
        await this._connect();
        const conversations = await this._client.getConversations({ numberOfConversations: this._numberOfConversations || 25});
        this._conversationsList = conversations.reverse();
        this._renderConversations();
    } catch (err) {
        console.error('Error retrieving conversations', err);
    }
  }

  // Get all direct conversation users for topic
  async _getDirectUsers() {
    return new Promise(async (resolve, reject) => {
      try {
        const directConversations = this._conversationsList.filter(c => c.type === Circuit.Enums.ConversationType.DIRECT);
        if (!directConversations.length) {
          resolve();
          return;
        }
        const directUserIds =  {};
        directConversations.forEach(c => {
          c.participants.forEach(p => {
            if (!directUserIds[p]) {
              directUserIds[p] = p;
            }
          })
        });
        const directUsers = await this._client.getUsersById(Object.keys(directUserIds));
        this._directUsers = {};
        directUsers.forEach(u => this._directUsers[u.userId] = u);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  async _renderConversations() {
    await this._getDirectUsers();
    this._conversationsList.forEach(conversation => this._conversationsListElement.appendChild(this._createConversationHtml(conversation)));
    // Emit event that conversations list is loaded
    this.dispatchEvent(new CustomEvent('loaded', { 
      detail: {
        client: this._client, // Expose the client so multiple components can use the same client
        conversations: this._conversationsList,
        directUsers: this._directUsers
      } 
    }));
  }

  // Takes in an item and returns the inner html for the conversation feed
  _createConversationHtml(conversation) {
    let node = document.createElement('option');
    node.className = 'circuit-conversation';
    node.id = conversation.convId;
    node.value = conversation.convId;
    let topic = !!conversation.isSupport ? 'Support' : conversation.topic || conversation.topicPlaceholder;
    if (conversation.type === Circuit.Enums.ConversationType.DIRECT) {
      const directUserId = conversation.participants.find(p => p !== this._client.loggedOnUser.userId);
      topic = this._directUsers[directUserId].displayName;
    }
    node.innerHTML = topic;
    return node;
  }

  // Reset values if conversation changes
  _resetValues() {
    this._conversationsList = null;
    this._directUsers = null;
  }

  fetchConversations() {
    this._resetValues();
    this._getConversations();
  }

  // Lifecycle hooks
  connectedCallback() {
    // Non-watched attributes
    this._client = this.getAttribute('client');
    this._clientId = this.getAttribute('clientId');
    this._domain = this.getAttribute('domain') || 'circuitsandbox.net';
    this._numberOfConversations = !!this.getAttribute('numberOfConversations') && Number(this.getAttribute('numberOfConversations'));
    this.fetchConversations = this.fetchConversations; // Expose fetchConversations externally
  }
}

customElements.define('circuit-conversations-list', CircuitConversationsList);
