document.addEventListener('DOMContentLoaded', function() {
  const SUPABASE_URL = "https://yqvyfruagujrkityxzkt.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxdnlmcnVhZ3VqcmtpdHl4emt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY3OTEyMzksImV4cCI6MjA1MjM2NzIzOX0.Rh_Mt1FRaCzksjuR0vaWt9kkz57MJsytirlYmp6oPTc";
  const MAX_MESSAGE_LENGTH = 300;
  const MESSAGE_COOLDOWN = 30000; // 30 seconds in milliseconds
  const RAPID_MESSAGE_THRESHOLD = 3; // Number of messages
  const RAPID_MESSAGE_WINDOW = 3000; // 3 seconds in milliseconds

  // Initialize Supabase client
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // DOM Elements
  const elements = {
    authContainer: document.getElementById("auth-container"),
    signupForm: document.getElementById("signup-form"),
    loginForm: document.getElementById("login-form"),
    chatContainer: document.getElementById("chat-container"),
    chatBox: document.getElementById("chat-box"),
    messageInput: document.getElementById("message-input"),
    currentUserBadge: document.getElementById("current-user"),
    charCount: document.getElementById("char-count")
  };

  let currentUser = null;
  let messageRefreshInterval = null;
  let recentMessages = []; // Array to track recent message timestamps
  let isInCooldown = false;

  // Real-time message subscription
  const messageSubscription = supabase
    .channel('messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      appendMessage(payload.new);
    })
    .subscribe();

  // Authentication functions
  window.showSignup = function() {
    elements.signupForm.classList.remove("d-none");
    elements.loginForm.classList.add("d-none");
    elements.signupForm.classList.add("animate__animated", "animate__fadeIn");
  }

  window.showLogin = function() {
    elements.loginForm.classList.remove("d-none");
    elements.signupForm.classList.add("d-none");
    elements.loginForm.classList.add("animate__animated", "animate__fadeIn");
  }

  window.signup = async function(event) {
    event.preventDefault();
    const username = document.getElementById("signup-username").value;
    const password = document.getElementById("signup-password").value;

    try {
      const { error } = await supabase.from("users").insert({ username, password });
      if (error) throw error;
      
      showNotification("Account created successfully! Please log in.", "success");
      showLogin();
    } catch (error) {
      showNotification("Error signing up: " + error.message, "error");
    }
  }

  window.login = async function(event) {
    event.preventDefault();
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;

    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .eq("password", password)
        .single();

      if (error || !data) throw new Error("Invalid credentials");

      currentUser = data;
      elements.currentUserBadge.textContent = username;
      elements.authContainer.classList.add("animate__animated", "animate__fadeOut");
      
      setTimeout(() => {
        elements.authContainer.classList.add("d-none");
        elements.chatContainer.classList.remove("d-none");
        elements.chatContainer.classList.add("animate__animated", "animate__fadeIn");
        loadMessages();
        // Start periodic refresh after successful login
        startPeriodicRefresh();
      }, 500);
    } catch (error) {
      showNotification("Invalid username or password", "error");
    }
  }

  window.logout = function() {
    currentUser = null;
    // Stop periodic refresh on logout
    stopPeriodicRefresh();
    elements.chatContainer.classList.add("animate__animated", "animate__fadeOut");
    
    setTimeout(() => {
      elements.chatContainer.classList.add("d-none");
      elements.authContainer.classList.remove("d-none", "animate__fadeOut");
      elements.authContainer.classList.add("animate__fadeIn");
      showLogin();
    }, 500);
  }

  function startPeriodicRefresh() {
    // Clear any existing interval first
    stopPeriodicRefresh();
    // Set new interval for every 5 seconds
    messageRefreshInterval = setInterval(loadMessages, 5000);
  }

  function stopPeriodicRefresh() {
    if (messageRefreshInterval) {
      clearInterval(messageRefreshInterval);
      messageRefreshInterval = null;
    }
  }

  // Set up message input character limit
  elements.messageInput.addEventListener('input', function() {
    const remainingChars = MAX_MESSAGE_LENGTH - this.value.length;
    elements.charCount.textContent = `${remainingChars} characters remaining`;
    elements.charCount.style.color = remainingChars < 50 ? '#ff4444' : 'white';
    
    if (this.value.length > MAX_MESSAGE_LENGTH) {
      this.value = this.value.substring(0, MAX_MESSAGE_LENGTH);
      showNotification("You've reached the character limit!", "warning");
    }
  });

  window.sendMessage = async function(event) {
    event.preventDefault();
    const message = elements.messageInput.value.trim();
    const now = Date.now();

    if (!currentUser || !message) return;
    if (message.length > MAX_MESSAGE_LENGTH) {
      showNotification("Message exceeds character limit!", "error");
      return;
    }

    if (isInCooldown) {
      const remainingCooldown = Math.ceil((MESSAGE_COOLDOWN - (now - recentMessages[recentMessages.length - 1])) / 1000);
      showNotification(`Please wait ${remainingCooldown} seconds before sending another message`, "warning");
      return;
    }

    // Clean up old messages from tracking array
    recentMessages = recentMessages.filter(time => now - time < RAPID_MESSAGE_WINDOW);
    
    // Add current message timestamp
    recentMessages.push(now);

    // Check if user has sent too many messages too quickly
    if (recentMessages.length >= RAPID_MESSAGE_THRESHOLD) {
      isInCooldown = true;
      showNotification("You're sending messages too quickly! Please wait 30 seconds.", "warning");
      
      setTimeout(() => {
        isInCooldown = false;
        recentMessages = [];
        showNotification("You can now send messages again!", "success");
      }, MESSAGE_COOLDOWN);
      
      return;
    }

    try {
      const { error } = await supabase
        .from("messages")
        .insert({
          username: currentUser.username,
          message: message,
          timestamp: new Date().toISOString()
        });

      if (error) throw error;
      
      elements.messageInput.value = "";
      elements.charCount.textContent = `${MAX_MESSAGE_LENGTH} characters remaining`;
      loadMessages();
    } catch (error) {
      console.error("Error sending message:", error);
      showNotification("Error sending message", "error");
    }
  }

  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function appendMessage(message) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${message.username === currentUser?.username ? 'sent' : 'received'}`;
    
    const escapedUsername = escapeHtml(message.username);
    const escapedMessage = escapeHtml(message.message);
    
    messageDiv.innerHTML = `
      <strong>${escapedUsername}</strong>
      <p>${escapedMessage}</p>
      <small class="text-muted">${new Date(message.timestamp).toLocaleString()}</small>
    `;
    
    elements.chatBox.querySelector('.messages-wrapper').appendChild(messageDiv);
    elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
  }

  async function loadMessages() {
    if (!currentUser) return; // Don't load messages if not logged in
    
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .order("timestamp", { ascending: true });

      if (error) throw error;
      
      const messagesWrapper = elements.chatBox.querySelector('.messages-wrapper');
      // Only clear and reload if there are new messages
      if (data.length !== messagesWrapper.children.length) {
        messagesWrapper.innerHTML = "";
        data.forEach(appendMessage);
      }
    } catch (error) {
      console.error("Error loading messages:", error);
      showNotification("Error loading messages", "error");
    }
  }

  function showNotification(message, type) {
    const notification = document.createElement("div");
    notification.className = `alert alert-${type} animate__animated animate__fadeIn`;
    notification.style.position = "fixed";
    notification.style.top = "20px";
    notification.style.right = "20px";
    notification.style.zIndex = "1000";
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.replace("animate__fadeIn", "animate__fadeOut");
      setTimeout(() => notification.remove(), 500);
    }, 3000);
  }
});
