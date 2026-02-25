// ELO Tracker Module
// Handles ELO score tracking for 4 players with 1v1 and 2v2 match types

const ELO_CONFIG = {
  K_FACTOR: 32,
  STARTING_ELO: 1000,
  SHEETS_TAB_NAME: 'ELO_Tracker',
  SHEET_ID: '14xNDTrFHdBrrVXnTait7Y8eAbsnHTUUq9PbB2VRGYS0' // Specific Google Sheet ID for ELO Tracker
};

// Use the same SHEETS_SYNC_ENDPOINT from script.js
const SHEETS_SYNC_ENDPOINT = '/.netlify/functions/sheets-sync';

// Fixed 4 players (can be customized)
// IMPORTANT: These must match the column order in Google Sheets:
// Column A (Player1 Name) = "Nabil Fikri" → Column I (Player1 ELO) = Nabil's ELO
// Column B (Player2 Name) = "Ikmal Hakim" → Column J (Player2 ELO) = Ikmal's ELO
// Column C (Player3 Name) = "Finn Lennon" → Column K (Player3 ELO) = Finn's ELO
// Column D (Player4 Name) = "Syazwan Mirza" → Column L (Player4 ELO) = Syazwan's ELO
let PLAYERS = ['Nabil Fikri', 'Ikmal Hakim', 'Finn Lennon', 'Syazwan Mirza'];

// Password protection
const ELO_PASSWORD = 'ilovedih';

// Current ELO scores (loaded from Google Sheets)
let currentELOScores = {};

// DOM Elements
let eloTrackerScreen, eloTrackerBtn, eloTrackerBackBtn;
let eloLeaderboard, eloMatchForm, eloMatchType, eloPlayerSelection, eloTeamSelection, eloWinningTeam;
let eloPasswordModal, eloPasswordForm, eloPasswordInput, eloPasswordError, eloPasswordCloseBtn, eloPasswordCancelBtn;
let eloMatchHistory;

// Initialize ELO Tracker
function initELOTracker() {
  // Get DOM elements
  eloTrackerScreen = document.getElementById('eloTrackerScreen');
  eloTrackerBtn = document.getElementById('eloTrackerBtn');
  eloTrackerBackBtn = document.getElementById('eloTrackerBackBtn');
  
  eloLeaderboard = document.getElementById('eloLeaderboard');
  eloMatchForm = document.getElementById('eloMatchForm');
  eloMatchType = document.getElementById('eloMatchType');
  eloPlayerSelection = document.getElementById('eloPlayerSelection');
  eloTeamSelection = document.getElementById('eloTeamSelection');
  eloWinningTeam = document.getElementById('eloWinningTeam');
  eloMatchHistory = document.getElementById('eloMatchHistory');
  
  // Password modal elements
  eloPasswordModal = document.getElementById('eloPasswordModal');
  eloPasswordForm = document.getElementById('eloPasswordForm');
  eloPasswordInput = document.getElementById('eloPassword');
  eloPasswordError = document.getElementById('eloPasswordError');
  eloPasswordCloseBtn = document.getElementById('eloPasswordCloseBtn');
  eloPasswordCancelBtn = document.getElementById('eloPasswordCancelBtn');

  // Set up event listeners
  if (eloTrackerBtn) {
    eloTrackerBtn.addEventListener('click', () => {
      showELOPasswordModal();
    });
  }
  
  // Password modal handlers
  if (eloPasswordForm) {
    eloPasswordForm.addEventListener('submit', handleELOPasswordSubmit);
  }
  
  if (eloPasswordCloseBtn) {
    eloPasswordCloseBtn.addEventListener('click', hideELOPasswordModal);
  }
  
  if (eloPasswordCancelBtn) {
    eloPasswordCancelBtn.addEventListener('click', hideELOPasswordModal);
  }
  
  if (eloPasswordModal) {
    eloPasswordModal.addEventListener('click', (e) => {
      if (e.target === eloPasswordModal) {
        hideELOPasswordModal();
      }
    });
  }

  if (eloTrackerBackBtn) {
    eloTrackerBackBtn.addEventListener('click', () => {
      hideELOTracker();
    });
  }

  if (eloMatchType) {
    eloMatchType.addEventListener('change', handleMatchTypeChange);
  }

  if (eloMatchForm) {
    eloMatchForm.addEventListener('submit', handleMatchSubmit);
  }

  // Initialize player selection
  initializePlayerSelection();
  
  // Load initial data from Google Sheets
  loadELOData();
}

// Show ELO Password Modal
function showELOPasswordModal() {
  if (eloPasswordModal) {
    eloPasswordModal.classList.remove('hidden');
    if (eloPasswordInput) {
      eloPasswordInput.focus();
      eloPasswordInput.value = '';
    }
    if (eloPasswordError) {
      eloPasswordError.classList.add('hidden');
      eloPasswordError.textContent = '';
    }
  }
}

// Hide ELO Password Modal
function hideELOPasswordModal() {
  if (eloPasswordModal) {
    eloPasswordModal.classList.add('hidden');
    if (eloPasswordForm) {
      eloPasswordForm.reset();
    }
  }
}

// Handle password form submission
function handleELOPasswordSubmit(e) {
  e.preventDefault();
  
  const enteredPassword = eloPasswordInput ? eloPasswordInput.value.trim() : '';
  
  if (enteredPassword === ELO_PASSWORD) {
    hideELOPasswordModal();
    showELOTracker();
  } else {
    if (eloPasswordError) {
      eloPasswordError.textContent = 'Incorrect password. Please try again.';
      eloPasswordError.classList.remove('hidden');
    }
    if (eloPasswordInput) {
      eloPasswordInput.value = '';
      eloPasswordInput.focus();
    }
  }
}

// Show ELO Tracker screen
function showELOTracker() {
  // Hide all screens
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  
  // Show ELO tracker screen
  if (eloTrackerScreen) {
    eloTrackerScreen.classList.add('active');
  }
  
  // Refresh data
  loadELOData();
  loadMatchHistory();
}

// Hide ELO Tracker screen
function hideELOTracker() {
  if (eloTrackerScreen) {
    eloTrackerScreen.classList.remove('active');
  }
  
  // Show home screen
  const homeScreen = document.getElementById('homeScreen');
  if (homeScreen) {
    homeScreen.classList.add('active');
  }
}

// Initialize player selection UI
function initializePlayerSelection() {
  if (!eloPlayerSelection) return;
  
  eloPlayerSelection.innerHTML = '';
  
  PLAYERS.forEach((player, index) => {
    const card = document.createElement('div');
    card.className = 'elo-player-card';
    card.dataset.playerIndex = index;
    card.innerHTML = `
      <div class="elo-player-card-name">${player}</div>
    `;
    card.addEventListener('click', () => togglePlayerSelection(card, index));
    eloPlayerSelection.appendChild(card);
  });
}

// Toggle player selection
let selectedPlayers = [];

function togglePlayerSelection(card, playerIndex) {
  const matchType = eloMatchType ? eloMatchType.value : '';
  const playerName = PLAYERS[playerIndex];
  const index = selectedPlayers.indexOf(playerIndex);
  
  if (index > -1) {
    // Deselect
    selectedPlayers.splice(index, 1);
    card.classList.remove('selected');
  } else {
    // Select based on match type
    if (matchType === '1v1') {
      // Max 2 players for 1v1
      if (selectedPlayers.length < 2) {
        selectedPlayers.push(playerIndex);
        card.classList.add('selected');
      }
    } else if (matchType === '2v2') {
      // Max 4 players for 2v2
      if (selectedPlayers.length < 4) {
        selectedPlayers.push(playerIndex);
        card.classList.add('selected');
      }
    }
  }
  
  if (matchType === '1v1') {
    updateWinningTeamOptions1v1();
  } else if (matchType === '2v2') {
    updateTeamSelection();
  }
}

// Handle match type change
function handleMatchTypeChange() {
  const matchType = eloMatchType.value;
  
  if (matchType === '1v1') {
    eloTeamSelection.classList.add('hidden');
    eloWinningTeam.disabled = false;
    updateWinningTeamOptions1v1();
    // Reset selection for 1v1 (need 2 players)
    selectedPlayers = [];
    initializePlayerSelection();
  } else if (matchType === '2v2') {
    eloTeamSelection.classList.remove('hidden');
    eloWinningTeam.disabled = true;
    // Reset selection for 2v2 (need 4 players)
    selectedPlayers = [];
    initializePlayerSelection();
  } else {
    eloTeamSelection.classList.add('hidden');
    eloWinningTeam.disabled = true;
    selectedPlayers = [];
    initializePlayerSelection();
  }
}

// Update team selection for 2v2
function updateTeamSelection() {
  if (eloMatchType.value !== '2v2') return;
  
  if (selectedPlayers.length === 4) {
    // Show generate button instead of auto-generating
    showGenerateTeamsButton();
  } else {
    eloTeamSelection.innerHTML = `
      <div class="elo-empty">Select 4 players to generate teams</div>
    `;
    // Clear teams
    window.eloTrackerTeamA = null;
    window.eloTrackerTeamB = null;
  }
}

// Show generate teams button
function showGenerateTeamsButton() {
  if (!eloTeamSelection) return;
  
  eloTeamSelection.innerHTML = `
    <button type="button" class="elo-generate-teams-btn" id="eloGenerateTeamsBtn">
      <span class="elo-generate-teams-icon">🎲</span>
      Generate Teams
    </button>
  `;
  
  const generateBtn = document.getElementById('eloGenerateTeamsBtn');
  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerateTeamsClick);
  }
}

// Handle generate teams button click with loading animation
async function handleGenerateTeamsClick() {
  if (selectedPlayers.length !== 4) return;
  
  const generateBtn = document.getElementById('eloGenerateTeamsBtn');
  if (!generateBtn) return;
  
  // Show loading state
  generateBtn.disabled = true;
  generateBtn.innerHTML = `
    <span class="elo-loading-spinner"></span>
    Generating Teams...
  `;
  
  // Wait 1.5 seconds before generating teams
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Generate teams
  generateRandomTeams();
}

// Generate random teams for 2v2
function generateRandomTeams() {
  if (selectedPlayers.length !== 4) return;
  
  // Create a copy and shuffle selected players (these are player indices)
  const shuffled = [...selectedPlayers];
  // Fisher-Yates shuffle for proper randomization
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  // Team A gets first 2 shuffled players, Team B gets last 2
  const teamA = [shuffled[0], shuffled[1]];
  const teamB = [shuffled[2], shuffled[3]];
  
  console.log('Generated teams:', {
    selectedPlayers,
    shuffled,
    teamA: teamA.map(i => PLAYERS[i]),
    teamB: teamB.map(i => PLAYERS[i])
  });
  
  renderTeamSelection(teamA, teamB);
}

// Render team selection UI
function renderTeamSelection(teamA, teamB) {
  if (!eloTeamSelection) return;
  
  eloTeamSelection.innerHTML = `
    <div class="elo-team">
      <div class="elo-team-header">Team A</div>
      <div class="elo-team-players">
        ${teamA.map(index => `<div class="elo-team-player">${PLAYERS[index]}</div>`).join('')}
      </div>
    </div>
    <div class="elo-team">
      <div class="elo-team-header">Team B</div>
      <div class="elo-team-players">
        ${teamB.map(index => `<div class="elo-team-player">${PLAYERS[index]}</div>`).join('')}
      </div>
    </div>
    <button type="button" class="elo-randomize-btn" onclick="window.eloTrackerRegenerateTeams()">🔄 Randomize Teams</button>
  `;
  
  // Store teams globally for form submission
  window.eloTrackerTeamA = teamA;
  window.eloTrackerTeamB = teamB;
  
  // Update winning team options
  updateWinningTeamOptions2v2();
}

// Regenerate teams with loading animation
async function regenerateTeamsWithLoading() {
  if (selectedPlayers.length !== 4) return;
  
  const randomizeBtn = document.querySelector('.elo-randomize-btn');
  if (!randomizeBtn) return;
  
  // Show loading state
  const originalText = randomizeBtn.innerHTML;
  randomizeBtn.disabled = true;
  randomizeBtn.innerHTML = `
    <span class="elo-loading-spinner"></span>
    Randomizing...
  `;
  
  // Wait 1.5 seconds before regenerating teams
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Generate teams
  generateRandomTeams();
}

// Make regenerate teams function globally accessible
window.eloTrackerRegenerateTeams = function() {
  if (selectedPlayers.length === 4) {
    regenerateTeamsWithLoading();
  }
};

// Update winning team options for 1v1
function updateWinningTeamOptions1v1() {
  if (!eloWinningTeam) return;
  
  eloWinningTeam.innerHTML = '<option value="">Select winning player...</option>';
  
  if (selectedPlayers.length === 2) {
    selectedPlayers.forEach(index => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = PLAYERS[index];
      eloWinningTeam.appendChild(option);
    });
    eloWinningTeam.disabled = false;
  } else {
    eloWinningTeam.disabled = true;
  }
}

// Update winning team options for 2v2
function updateWinningTeamOptions2v2() {
  if (!eloWinningTeam) return;
  
  eloWinningTeam.innerHTML = '<option value="">Select winning team...</option>';
  
  if (window.eloTrackerTeamA && window.eloTrackerTeamB) {
    const optionA = document.createElement('option');
    optionA.value = 'A';
    optionA.textContent = `Team A (${window.eloTrackerTeamA.map(i => PLAYERS[i]).join(', ')})`;
    eloWinningTeam.appendChild(optionA);
    
    const optionB = document.createElement('option');
    optionB.value = 'B';
    optionB.textContent = `Team B (${window.eloTrackerTeamB.map(i => PLAYERS[i]).join(', ')})`;
    eloWinningTeam.appendChild(optionB);
    
    eloWinningTeam.disabled = false;
  } else {
    eloWinningTeam.disabled = true;
  }
}

// Handle match form submission
async function handleMatchSubmit(e) {
  e.preventDefault();
  
  const matchType = eloMatchType.value;
  const winningTeam = eloWinningTeam.value;
  
  if (!matchType || !winningTeam) {
    alert('Please select match type and winning team');
    return;
  }
  
  let matchData;
  
  if (matchType === '1v1') {
    if (selectedPlayers.length !== 2) {
      alert('Please select 2 players for 1v1 match');
      return;
    }
    
    const player1Index = selectedPlayers[0];
    const player2Index = selectedPlayers[1];
    const winnerIndex = parseInt(winningTeam);
    
    const player1Name = PLAYERS[player1Index];
    const player2Name = PLAYERS[player2Index];
    const winnerName = PLAYERS[winnerIndex];
    
    // IMPORTANT: Columns must always represent the same players in order:
    // Column A (index 0) = Nabil, Column B (index 1) = Ikmal, Column C (index 2) = Finn, Column D (index 3) = Syazwan
    // Map each player to their correct column position based on their index in PLAYERS array
    const columns = ['player1', 'player2', 'player3', 'player4'];
    const eloColumns = ['player1ELO', 'player2ELO', 'player3ELO', 'player4ELO'];
    
    // Initialize all columns as empty
    matchData = {
      matchType: '1v1',
      player1: '',
      player2: '',
      player3: '',
      player4: '',
      player1ELO: '',
      player2ELO: '',
      player3ELO: '',
      player4ELO: '',
      winner: winnerName,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().split(' ')[0].substring(0, 8)
    };
    
    // Calculate ELO changes
    // IMPORTANT: Pass players in the order they were selected, calculate ELO, then map to correct columns
    const player1Rating = currentELOScores[player1Name] || ELO_CONFIG.STARTING_ELO;
    const player2Rating = currentELOScores[player2Name] || ELO_CONFIG.STARTING_ELO;
    const player1Wins = winnerIndex === player1Index;
    
    const eloChanges = calculateELO1v1(
      player1Rating,
      player2Rating,
      player1Wins
    );
    
    // Map players to their correct columns based on their index in PLAYERS array
    // player1Index (e.g., 0 = Nabil) → player1 column (Column A)
    // player2Index (e.g., 2 = Finn) → player3 column (Column C)
    // The ELO calculation returns newRating1 for the first player passed, newRating2 for the second
    matchData[columns[player1Index]] = player1Name;
    matchData[eloColumns[player1Index]] = eloChanges.newRating1; // First player's new ELO
    
    matchData[columns[player2Index]] = player2Name;
    matchData[eloColumns[player2Index]] = eloChanges.newRating2; // Second player's new ELO
    
    // IMPORTANT: Fill in the other players' names and ELO scores from their latest values
    // This ensures every row has all 4 players' current ELO scores
    PLAYERS.forEach((playerName, index) => {
      if (index !== player1Index && index !== player2Index) {
        // This player didn't play, use their current ELO score
        matchData[columns[index]] = playerName;
        matchData[eloColumns[index]] = currentELOScores[playerName] || ELO_CONFIG.STARTING_ELO;
      }
    });
    
    // Debug logging
    console.log('1v1 Match Data:', {
      player1Index,
      player2Index,
      player1Name,
      player2Name,
      player1Rating,
      player2Rating,
      player1Wins,
      newRating1: eloChanges.newRating1,
      newRating2: eloChanges.newRating2,
      matchData: {
        players: [matchData.player1, matchData.player2, matchData.player3, matchData.player4],
        eloScores: [matchData.player1ELO, matchData.player2ELO, matchData.player3ELO, matchData.player4ELO]
      }
    });
    
    // Store the ELO changes mapped to correct column positions
    // Initialize all change columns as empty strings first
    const changeColumns = ['player1Change', 'player2Change', 'player3Change', 'player4Change'];
    changeColumns.forEach(col => {
      matchData[col] = '';
    });
    // Then set the actual changes for players who participated
    matchData[changeColumns[player1Index]] = eloChanges.change1;
    matchData[changeColumns[player2Index]] = eloChanges.change2;
    
  } else if (matchType === '2v2') {
    if (!window.eloTrackerTeamA || !window.eloTrackerTeamB) {
      alert('Please generate teams first');
      return;
    }
    
    const teamA = window.eloTrackerTeamA;
    const teamB = window.eloTrackerTeamB;
    const winnerIsA = winningTeam === 'A';
    
    // Ensure correct mapping: Team A players → player1 & player2, Team B players → player3 & player4
    const teamAPlayer1 = PLAYERS[teamA[0]];
    const teamAPlayer2 = PLAYERS[teamA[1]];
    const teamBPlayer1 = PLAYERS[teamB[0]];
    const teamBPlayer2 = PLAYERS[teamB[1]];
    
    // Calculate ELO changes for 2v2
    const teamARating1 = currentELOScores[teamAPlayer1] || ELO_CONFIG.STARTING_ELO;
    const teamARating2 = currentELOScores[teamAPlayer2] || ELO_CONFIG.STARTING_ELO;
    const teamBRating1 = currentELOScores[teamBPlayer1] || ELO_CONFIG.STARTING_ELO;
    const teamBRating2 = currentELOScores[teamBPlayer2] || ELO_CONFIG.STARTING_ELO;
    
    const eloChanges = calculateELO2v2(
      [teamARating1, teamARating2],
      [teamBRating1, teamBRating2],
      winnerIsA
    );
    
    // Map each player to their correct column based on their index in PLAYERS array
    // Column A (index 0) = Nabil, Column B (index 1) = Ikmal, Column C (index 2) = Finn, Column D (index 3) = Syazwan
    const columns = ['player1', 'player2', 'player3', 'player4'];
    const eloColumns = ['player1ELO', 'player2ELO', 'player3ELO', 'player4ELO'];
    
    // Format winning team as player names
    const winningTeamPlayers = winnerIsA ? [teamAPlayer1, teamAPlayer2] : [teamBPlayer1, teamBPlayer2];
    const winningTeamNames = winningTeamPlayers.join(' and ');
    
    // Initialize all columns as empty
    matchData = {
      matchType: '2v2',
      player1: '',
      player2: '',
      player3: '',
      player4: '',
      player1ELO: '',
      player2ELO: '',
      player3ELO: '',
      player4ELO: '',
      winningTeam: winningTeamNames, // Use player names instead of 'A' or 'B'
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().split(' ')[0].substring(0, 8)
    };
    
    // Map each player to their correct column position based on their index in PLAYERS array
    // teamA[0] (e.g., index 0 = Nabil) → player1 column (Column A)
    // teamA[1] (e.g., index 2 = Finn) → player3 column (Column C)
    // teamB[0] (e.g., index 1 = Ikmal) → player2 column (Column B)
    // teamB[1] (e.g., index 3 = Syazwan) → player4 column (Column D)
    matchData[columns[teamA[0]]] = teamAPlayer1;
    matchData[eloColumns[teamA[0]]] = eloChanges.newRating1;
    
    matchData[columns[teamA[1]]] = teamAPlayer2;
    matchData[eloColumns[teamA[1]]] = eloChanges.newRating2;
    
    matchData[columns[teamB[0]]] = teamBPlayer1;
    matchData[eloColumns[teamB[0]]] = eloChanges.newRating3;
    
    matchData[columns[teamB[1]]] = teamBPlayer2;
    matchData[eloColumns[teamB[1]]] = eloChanges.newRating4;
    
    // Store the ELO changes mapped to correct column positions
    // Initialize all change columns as empty strings first
    const changeColumns = ['player1Change', 'player2Change', 'player3Change', 'player4Change'];
    changeColumns.forEach(col => {
      matchData[col] = '';
    });
    // Then set the actual changes for players who participated
    matchData[changeColumns[teamA[0]]] = eloChanges.change1;
    matchData[changeColumns[teamA[1]]] = eloChanges.change2;
    matchData[changeColumns[teamB[0]]] = eloChanges.change3;
    matchData[changeColumns[teamB[1]]] = eloChanges.change4;
    
    // Debug logging
    console.log('ELO Match Data:', {
      teamA: [teamAPlayer1, teamAPlayer2],
      teamB: [teamBPlayer1, teamBPlayer2],
      teamAIndices: teamA,
      teamBIndices: teamB,
      players: [matchData.player1, matchData.player2, matchData.player3, matchData.player4],
      eloScores: [matchData.player1ELO, matchData.player2ELO, matchData.player3ELO, matchData.player4ELO]
    });
  }
  
  // Sync to Google Sheets
  try {
    await syncMatchToSheets(matchData);
    
    // Update local scores
    updateLocalScores(matchData);
    
    // Refresh UI
    renderLeaderboard();
    loadMatchHistory();
    
    // Reset form
    eloMatchForm.reset();
    selectedPlayers = [];
    initializePlayerSelection();
    eloTeamSelection.classList.add('hidden');
    eloWinningTeam.disabled = true;
    
    alert('Match recorded successfully!');
  } catch (error) {
    console.error('Error syncing match:', error);
    alert('Error recording match. Please try again.');
  }
}

// Calculate ELO for 1v1 match
function calculateELO1v1(rating1, rating2, player1Wins) {
  const expected1 = 1 / (1 + Math.pow(10, (rating2 - rating1) / 400));
  const expected2 = 1 / (1 + Math.pow(10, (rating1 - rating2) / 400));
  
  const score1 = player1Wins ? 1 : 0;
  const score2 = player1Wins ? 0 : 1;
  
  // Calculate rating difference
  const ratingDiff = Math.abs(rating1 - rating2);
  
  // Variable K factor: increases with rating difference to reward upsets more
  // Base K factor of 32, scales up to 48 for large rating differences (200+ points)
  // This makes it more rewarding for lower-rated players to beat higher-rated players
  const variableK = ELO_CONFIG.K_FACTOR + Math.min(ratingDiff / 10, 16);
  
  // Determine which player is the underdog
  const player1IsUnderdog = rating1 < rating2;
  const player2IsUnderdog = rating2 < rating1;
  
  // Apply bonus multiplier for upsets (underdog wins)
  let k1 = variableK;
  let k2 = variableK;
  
  if (player1Wins && player1IsUnderdog) {
    // Player 1 (underdog) wins - give bonus
    k1 = variableK * 1.25; // 25% bonus for upset
    k2 = variableK * 0.75; // Reduced loss for higher-rated player
  } else if (!player1Wins && player2IsUnderdog) {
    // Player 2 (underdog) wins - give bonus
    k2 = variableK * 1.25; // 25% bonus for upset
    k1 = variableK * 0.75; // Reduced loss for higher-rated player
  } else if (player1Wins && !player1IsUnderdog) {
    // Higher-rated player wins - reduce gains
    k1 = variableK * 0.75; // Reduced gain for beating lower-rated player
    k2 = variableK * 1.0;  // Normal loss
  } else {
    // Higher-rated player wins - reduce gains
    k2 = variableK * 0.75; // Reduced gain for beating lower-rated player
    k1 = variableK * 1.0;  // Normal loss
  }
  
  const change1 = Math.round(k1 * (score1 - expected1));
  const change2 = Math.round(k2 * (score2 - expected2));
  
  return {
    newRating1: rating1 + change1,
    newRating2: rating2 + change2,
    change1: change1,
    change2: change2
  };
}

// Calculate ELO for 2v2 match
function calculateELO2v2(teamARatings, teamBRatings, teamAWins) {
  // Average team ratings
  const teamARating = (teamARatings[0] + teamARatings[1]) / 2;
  const teamBRating = (teamBRatings[0] + teamBRatings[1]) / 2;
  
  // Calculate expected scores
  const expectedA = 1 / (1 + Math.pow(10, (teamBRating - teamARating) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (teamARating - teamBRating) / 400));
  
  const scoreA = teamAWins ? 1 : 0;
  const scoreB = teamAWins ? 0 : 1;
  
  // Calculate rating difference between teams
  const ratingDiff = Math.abs(teamARating - teamBRating);
  
  // Variable K factor: increases with rating difference to reward upsets more
  // Base K factor of 32, scales up to 48 for large rating differences (200+ points)
  const variableK = ELO_CONFIG.K_FACTOR + Math.min(ratingDiff / 10, 16);
  
  // Determine which team is the underdog
  const teamAIsUnderdog = teamARating < teamBRating;
  const teamBIsUnderdog = teamBRating < teamARating;
  
  // Apply bonus multiplier for upsets (underdog team wins)
  let kA = variableK;
  let kB = variableK;
  
  if (teamAWins && teamAIsUnderdog) {
    // Team A (underdog) wins - give bonus
    kA = variableK * 1.25; // 25% bonus for upset
    kB = variableK * 0.75; // Reduced loss for higher-rated team
  } else if (!teamAWins && teamBIsUnderdog) {
    // Team B (underdog) wins - give bonus
    kB = variableK * 1.25; // 25% bonus for upset
    kA = variableK * 0.75; // Reduced loss for higher-rated team
  } else if (teamAWins && !teamAIsUnderdog) {
    // Higher-rated team wins - reduce gains
    kA = variableK * 0.75; // Reduced gain for beating lower-rated team
    kB = variableK * 1.0;  // Normal loss
  } else {
    // Higher-rated team wins - reduce gains
    kB = variableK * 0.75; // Reduced gain for beating lower-rated team
    kA = variableK * 1.0;  // Normal loss
  }
  
  // Calculate changes for each player
  const changeA = Math.round(kA * (scoreA - expectedA));
  const changeB = Math.round(kB * (scoreB - expectedB));
  
  return {
    newRating1: teamARatings[0] + changeA,
    newRating2: teamARatings[1] + changeA,
    newRating3: teamBRatings[0] + changeB,
    newRating4: teamBRatings[1] + changeB,
    change1: changeA,
    change2: changeA,
    change3: changeB,
    change4: changeB
  };
}

// Sync match data to Google Sheets
async function syncMatchToSheets(matchData) {
  const response = await fetch(SHEETS_SYNC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      eloMatch: true,
      sheetId: ELO_CONFIG.SHEET_ID, // Use specific sheet ID for ELO tracker
      tabName: ELO_CONFIG.SHEETS_TAB_NAME,
      ...matchData
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to sync match to Google Sheets');
  }
  
  return await response.json();
}

// Update local scores after match
function updateLocalScores(matchData) {
  // Update scores for all players (all 4 players should have ELO scores now)
  // Columns always represent: A=Nabil, B=Ikmal, C=Finn, D=Syazwan
  if (matchData.player1 && matchData.player1ELO !== '' && matchData.player1ELO !== null && matchData.player1ELO !== undefined) {
    currentELOScores[matchData.player1] = matchData.player1ELO;
  }
  if (matchData.player2 && matchData.player2ELO !== '' && matchData.player2ELO !== null && matchData.player2ELO !== undefined) {
    currentELOScores[matchData.player2] = matchData.player2ELO;
  }
  if (matchData.player3 && matchData.player3ELO !== '' && matchData.player3ELO !== null && matchData.player3ELO !== undefined) {
    currentELOScores[matchData.player3] = matchData.player3ELO;
  }
  if (matchData.player4 && matchData.player4ELO !== '' && matchData.player4ELO !== null && matchData.player4ELO !== undefined) {
    currentELOScores[matchData.player4] = matchData.player4ELO;
  }
}

// Load ELO data from Google Sheets
async function loadELOData() {
  try {
    // Load current scores (from last row of each player column)
    const response = await fetch(`${SHEETS_SYNC_ENDPOINT}?tabName=${ELO_CONFIG.SHEETS_TAB_NAME}&sheetId=${ELO_CONFIG.SHEET_ID}`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.records) {
        // Process records to get latest ELO scores
        processELORecords(data.records);
      }
    }
    
    // Initialize scores if not loaded
    PLAYERS.forEach(player => {
      if (!currentELOScores[player]) {
        currentELOScores[player] = ELO_CONFIG.STARTING_ELO;
      }
    });
    
    // Render UI
    renderLeaderboard();
  } catch (error) {
    console.error('Error loading ELO data:', error);
    // Initialize with starting ELO if load fails
    PLAYERS.forEach(player => {
      currentELOScores[player] = ELO_CONFIG.STARTING_ELO;
    });
    renderLeaderboard();
  }
}

// Process ELO records from Google Sheets
function processELORecords(records) {
  // Initialize all players with starting ELO
  PLAYERS.forEach(player => {
    currentELOScores[player] = ELO_CONFIG.STARTING_ELO;
  });
  
  if (!records || records.length === 0) {
    return;
  }
  
  // Helper function to parse date/time that might be stored as numbers or strings
  const parseDateTime = (dateValue, timeValue) => {
    let dateStr = dateValue;
    let timeStr = timeValue || '00:00:00';
    
    // If date is a number (serial number), convert it
    if (typeof dateValue === 'number' || (!isNaN(dateValue) && !isNaN(parseFloat(dateValue)))) {
      // Google Sheets date serial number (days since 1899-12-30)
      const serialDate = parseFloat(dateValue);
      const baseDate = new Date(1899, 11, 30); // December 30, 1899
      const date = new Date(baseDate.getTime() + serialDate * 24 * 60 * 60 * 1000);
      dateStr = date.toISOString().split('T')[0];
    }
    
    // If time is a decimal (fraction of day), convert it
    if (typeof timeValue === 'number' || (!isNaN(timeValue) && !isNaN(parseFloat(timeValue)) && parseFloat(timeValue) < 1)) {
      const fraction = parseFloat(timeValue);
      const hours = Math.floor(fraction * 24);
      const minutes = Math.floor((fraction * 24 - hours) * 60);
      const seconds = Math.floor(((fraction * 24 - hours) * 60 - minutes) * 60);
      timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    return new Date(`${dateStr} ${timeStr}`);
  };
  
  // Sort records chronologically (oldest first) to process matches in order
  const sortedRecords = [...records].sort((a, b) => {
    const dateA = parseDateTime(a.Date, a.Time);
    const dateB = parseDateTime(b.Date, b.Time);
    return dateA - dateB;
  });
  
  // Process each match chronologically to build up ELO scores
  // The ELO scores stored in the sheet are the cumulative scores AFTER each match
  // IMPORTANT: Columns always represent the same players:
  // Column A (Player1 Name) = Nabil, Column B (Player2 Name) = Ikmal, Column C (Player3 Name) = Finn, Column D (Player4 Name) = Syazwan
  sortedRecords.forEach(record => {
    const matchType = record['Match Type'] || record.MatchType;
    
    // Map column names to player names and ELO scores
    const columnPlayers = [
      (record['Player1 Name'] || record.Player1 || '').trim(),
      (record['Player2 Name'] || record.Player2 || '').trim(),
      (record['Player3 Name'] || record.Player3 || '').trim(),
      (record['Player4 Name'] || record.Player4 || '').trim()
    ];
    
    const columnELOs = [
      parseFloat(record['Player1 ELO'] || record.Player1ELO),
      parseFloat(record['Player2 ELO'] || record.Player2ELO),
      parseFloat(record['Player3 ELO'] || record.Player3ELO),
      parseFloat(record['Player4 ELO'] || record.Player4ELO)
    ];
    
    // Update ELO scores for each player that participated
    columnPlayers.forEach((playerName, colIndex) => {
      if (playerName && !isNaN(columnELOs[colIndex]) && columnELOs[colIndex] > 0) {
        currentELOScores[playerName] = columnELOs[colIndex];
      }
    });
  });
}

// Render leaderboard
function renderLeaderboard() {
  if (!eloLeaderboard) return;
  
  // Sort players by ELO score
  const sortedPlayers = PLAYERS.map(player => ({
    name: player,
    score: currentELOScores[player] || ELO_CONFIG.STARTING_ELO
  })).sort((a, b) => b.score - a.score);
  
  eloLeaderboard.innerHTML = sortedPlayers.map((player, index) => {
    const rank = index + 1;
    let rankClass = '';
    if (rank === 1) rankClass = 'gold';
    else if (rank === 2) rankClass = 'silver';
    else if (rank === 3) rankClass = 'bronze';
    
    return `
      <div class="elo-leaderboard-item">
        <div class="elo-rank ${rankClass}">#${rank}</div>
        <div class="elo-player-info">
          <div class="elo-player-name">${player.name}</div>
          <div class="elo-player-stats">
            <span>ELO: ${player.score}</span>
          </div>
        </div>
        <div class="elo-score">${player.score}</div>
      </div>
    `;
  }).join('');
}

// Load match history from Google Sheets
async function loadMatchHistory() {
  if (!eloMatchHistory) return;
  
  try {
    eloMatchHistory.innerHTML = '<div class="elo-loading">Loading match history...</div>';
    
    const response = await fetch(`${SHEETS_SYNC_ENDPOINT}?tabName=${ELO_CONFIG.SHEETS_TAB_NAME}&sheetId=${ELO_CONFIG.SHEET_ID}`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.records && data.records.length > 0) {
        renderMatchHistory(data.records);
      } else {
        eloMatchHistory.innerHTML = '<div class="elo-empty">No match history yet</div>';
      }
    } else {
      eloMatchHistory.innerHTML = '<div class="elo-empty">Failed to load match history</div>';
    }
  } catch (error) {
    console.error('Error loading match history:', error);
    eloMatchHistory.innerHTML = '<div class="elo-empty">Error loading match history</div>';
  }
}

// Render match history
function renderMatchHistory(records) {
  if (!eloMatchHistory) return;
  
  // Helper function to parse date/time
  const parseDateTime = (dateValue, timeValue) => {
    let dateStr = dateValue;
    let timeStr = timeValue || '00:00:00';
    
    if (typeof dateValue === 'number' || (!isNaN(dateValue) && !isNaN(parseFloat(dateValue)))) {
      const serialDate = parseFloat(dateValue);
      const baseDate = new Date(1899, 11, 30);
      const date = new Date(baseDate.getTime() + serialDate * 24 * 60 * 60 * 1000);
      dateStr = date.toISOString().split('T')[0];
    }
    
    if (typeof timeValue === 'number' || (!isNaN(timeValue) && !isNaN(parseFloat(timeValue)) && parseFloat(timeValue) < 1)) {
      const fraction = parseFloat(timeValue);
      const hours = Math.floor(fraction * 24);
      const minutes = Math.floor((fraction * 24 - hours) * 60);
      const seconds = Math.floor(((fraction * 24 - hours) * 60 - minutes) * 60);
      timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    return { dateStr, timeStr };
  };
  
  // Sort records by date/time (newest first)
  const sortedRecords = [...records].sort((a, b) => {
    const dateA = parseDateTime(a.Date, a.Time);
    const dateB = parseDateTime(b.Date, b.Time);
    const fullDateA = new Date(`${dateA.dateStr} ${dateA.timeStr}`);
    const fullDateB = new Date(`${dateB.dateStr} ${dateB.timeStr}`);
    return fullDateB - fullDateA; // Newest first
  });
  
  eloMatchHistory.innerHTML = sortedRecords.map(record => {
    const matchType = record['Match Type'] || record.MatchType || 'Unknown';
    const dateTime = parseDateTime(record.Date, record.Time);
    const formattedDate = new Date(`${dateTime.dateStr} ${dateTime.timeStr}`).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Get players - maintain column positions
    const players = [
      (record['Player1 Name'] || record.Player1 || '').trim(),
      (record['Player2 Name'] || record.Player2 || '').trim(),
      (record['Player3 Name'] || record.Player3 || '').trim(),
      (record['Player4 Name'] || record.Player4 || '').trim()
    ];
    
    // Get ELO changes from sheet columns (Player1 Change, Player2 Change, etc.)
    const changeColumnNames = ['Player1 Change', 'Player2 Change', 'Player3 Change', 'Player4 Change'];
    const eloChanges = changeColumnNames.map(colName => {
      const changeValue = record[colName] || null;
      if (changeValue !== null && changeValue !== undefined && changeValue !== '') {
        const num = parseFloat(changeValue);
        return isNaN(num) ? null : num;
      }
      return null;
    });
    
    // Create a map of player name to ELO change
    const playerChangeMap = {};
    players.forEach((player, index) => {
      if (player && eloChanges[index] !== null && eloChanges[index] !== undefined) {
        playerChangeMap[player] = eloChanges[index];
      }
    });
    
    // Get winner - column name is "Winning Team"
    const winner = record['Winning Team'] || record['Winner'] || record['winningTeam'] || record.winner || 'Unknown';
    
    let matchContent = '';
    
    if (matchType === '1v1') {
      // 1v1 match display
      const player1 = players[0] || 'Unknown';
      const player2 = players[1] || 'Unknown';
      const change1 = playerChangeMap[player1] !== undefined ? playerChangeMap[player1] : null;
      const change2 = playerChangeMap[player2] !== undefined ? playerChangeMap[player2] : null;
      
      const winnerIsPlayer1 = winner === player1 || winner.includes(player1);
      
      matchContent = `
        <div class="elo-match-teams">
          <div class="elo-match-team ${winnerIsPlayer1 ? 'winner' : ''}">
            <div class="elo-match-team-players">${player1}</div>
            ${change1 !== null && change1 !== undefined ? `<div class="elo-match-score-change ${change1 >= 0 ? 'positive' : 'negative'}">${change1 >= 0 ? '+' : ''}${change1}</div>` : ''}
          </div>
          <div class="elo-match-vs">VS</div>
          <div class="elo-match-team ${!winnerIsPlayer1 ? 'winner' : ''}">
            <div class="elo-match-team-players">${player2}</div>
            ${change2 !== null && change2 !== undefined ? `<div class="elo-match-score-change ${change2 >= 0 ? 'positive' : 'negative'}">${change2 >= 0 ? '+' : ''}${change2}</div>` : ''}
          </div>
        </div>
        <div class="elo-match-winner">Winner: <strong>${winner}</strong></div>
      `;
    } else if (matchType === '2v2') {
      // 2v2 match display - determine teams from player positions
      // For 2v2, we need to identify which players were on which team
      // Try to parse from winner field first, otherwise use column positions
      const teamAPlayers = [];
      const teamBPlayers = [];
      
      // Get all players with their indices
      const allPlayersWithIndex = players.map((player, idx) => ({ name: player, index: idx })).filter(p => p.name);
      
      // Try to identify teams from winner field
      const winnerLower = winner.toLowerCase();
      const winnerPlayers = allPlayersWithIndex.filter(p => winnerLower.includes(p.name.toLowerCase()));
      
      if (winnerPlayers.length === 2) {
        // Winner field contains exactly 2 players - they're the winning team
        winnerPlayers.forEach(p => teamAPlayers.push(p));
        allPlayersWithIndex.filter(p => !winnerPlayers.includes(p)).forEach(p => teamBPlayers.push(p));
      } else {
        // Fallback: use first 2 players as Team A, last 2 as Team B
        allPlayersWithIndex.forEach((p, idx) => {
          if (idx < 2) {
            teamAPlayers.push(p);
          } else {
            teamBPlayers.push(p);
          }
        });
      }
      
      const teamAPlayerNames = teamAPlayers.map(p => p.name);
      const teamBPlayerNames = teamBPlayers.map(p => p.name);
      
      // Determine which team won
      const winnerIsTeamA = teamAPlayerNames.some(p => winner.includes(p)) || 
                           (teamAPlayerNames.length === 2 && teamAPlayerNames.every(p => winner.includes(p)));
      
      matchContent = `
        <div class="elo-match-teams">
          <div class="elo-match-team ${winnerIsTeamA ? 'winner' : ''}">
            <div class="elo-match-team-header">Team A</div>
            <div class="elo-match-team-players">${teamAPlayerNames.join(' & ')}</div>
            <div class="elo-match-scores">
              ${teamAPlayers.map(p => {
                const change = playerChangeMap[p.name];
                return change !== null && change !== undefined ? 
                  `<div class="elo-match-score-change ${change >= 0 ? 'positive' : 'negative'}">${p.name}: ${change >= 0 ? '+' : ''}${change}</div>` : '';
              }).filter(h => h).join('')}
            </div>
          </div>
          <div class="elo-match-vs">VS</div>
          <div class="elo-match-team ${!winnerIsTeamA ? 'winner' : ''}">
            <div class="elo-match-team-header">Team B</div>
            <div class="elo-match-team-players">${teamBPlayerNames.join(' & ')}</div>
            <div class="elo-match-scores">
              ${teamBPlayers.map(p => {
                const change = playerChangeMap[p.name];
                return change !== null && change !== undefined ? 
                  `<div class="elo-match-score-change ${change >= 0 ? 'positive' : 'negative'}">${p.name}: ${change >= 0 ? '+' : ''}${change}</div>` : '';
              }).filter(h => h).join('')}
            </div>
          </div>
        </div>
        <div class="elo-match-winner">Winner: <strong>${winner}</strong></div>
      `;
    } else {
      matchContent = `
        <div class="elo-match-teams">
          <div class="elo-match-team-players">${players.join(', ')}</div>
        </div>
        <div class="elo-match-winner">Winner: <strong>${winner}</strong></div>
      `;
    }
    
    return `
      <div class="elo-match-item">
        <div class="elo-match-header">
          <span class="elo-match-type">${matchType}</span>
          <span class="elo-match-date">${formattedDate}</span>
        </div>
        ${matchContent}
      </div>
    `;
  }).join('');
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initELOTracker);
} else {
  initELOTracker();
}

// Export for manual initialization if needed
window.initELOTracker = initELOTracker;
