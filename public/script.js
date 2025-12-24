let currentGameId = null;
let currentRow = 0;
let currentGuess = "";
let isGameOver = false;
let isAnimating = false;
const MAX_ATTEMPTS = 9;

window.onload = () => {
    // --- NOVO: RASTREADOR DE VISITAS ---
    // Avisa o backend que alguém entrou no site
    fetch('/api/visit')
        .then(() => console.log("📊 Visita registrada!"))
        .catch(err => console.log("⚠️ Não foi possível registrar visita (Backend offline?)"));

    // --- LÓGICA DE JOGO E BLOQUEIO ---
    
    // 1. Atualiza visual dos botões (bloqueia os que já foram jogados hoje)
    updateLockedButtons();

    // 2. Tenta iniciar o primeiro modo disponível
    if (!isModeLocked('termo')) startGame('termo');
    else if (!isModeLocked('dueto')) startGame('dueto');
    else if (!isModeLocked('quarteto')) startGame('quarteto');
    else showFullLockScreen(); // Tudo bloqueado
};

// --- CONTROLE DE BLOQUEIO GRANULAR ---

// Verifica se UM modo específico está bloqueado hoje
function isModeLocked(mode) {
    const lastPlayed = localStorage.getItem(`termo_lock_${mode}`);
    const today = new Date().toDateString(); 
    return lastPlayed === today;
}

// Salva o bloqueio APENAS para o modo atual
function saveModeLock(mode) {
    const today = new Date().toDateString();
    localStorage.setItem(`termo_lock_${mode}`, today);
    updateLockedButtons();
}

// Percorre os botões e desabilita visualmente os bloqueados
function updateLockedButtons() {
    const modes = ['termo', 'dueto', 'quarteto'];
    modes.forEach(m => {
        const btn = document.getElementById(`btn-${m}`);
        if (isModeLocked(m)) {
            btn.disabled = true;
            btn.classList.remove('active');
        } else {
            btn.disabled = false;
        }
    });
}

function showFullLockScreen() {
    document.getElementById('game-area').classList.add('hidden');
    document.getElementById('daily-lock').classList.remove('hidden');
}

// --- JOGO ---

async function startGame(mode) {
    // Se tentar clicar num modo bloqueado, aborta
    if (isModeLocked(mode)) return;

    // Reset visual
    currentRow = 0;
    currentGuess = "";
    isGameOver = false;
    isAnimating = false;
    showMessage("");
    document.getElementById('game-area').classList.remove('hidden');
    document.getElementById('daily-lock').classList.add('hidden');

    // Atualiza botões ativos
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${mode}`).classList.add('active');

    try {
        const response = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Erro ao iniciar");
        }
        
        const data = await response.json();
        currentGameId = data.gameId;
        
        // Guarda o modo atual no container para sabermos qual bloquear depois
        document.getElementById('game-area').dataset.mode = mode;
        
        createBoards(mode);

    } catch (error) {
        showMessage(error.message);
    }
}

function createBoards(mode) {
    const container = document.getElementById('boards-container');
    container.innerHTML = '';
    
    let numBoards = 1;
    if (mode === 'dueto') numBoards = 2;
    if (mode === 'quarteto') numBoards = 4;

    for (let i = 0; i < numBoards; i++) {
        const board = document.createElement('div');
        board.className = 'board';
        board.id = `board-${i}`;

        for (let r = 0; r < MAX_ATTEMPTS; r++) {
            const row = document.createElement('div');
            row.className = 'row';
            row.id = `board-${i}-row-${r}`;
            for (let c = 0; c < 5; c++) {
                const tile = document.createElement('div');
                tile.className = 'tile';
                row.appendChild(tile);
            }
            board.appendChild(row);
        }
        container.appendChild(board);
    }
}

document.addEventListener('keydown', (e) => {
    if (isGameOver || isAnimating) return;

    const key = e.key.toUpperCase();
    if (/^[A-Z]$/.test(key)) {
        if (currentGuess.length < 5) {
            currentGuess += key;
            updateCurrentTiles();
        }
    } else if (e.key === 'Backspace') {
        currentGuess = currentGuess.slice(0, -1);
        updateCurrentTiles();
    } else if (e.key === 'Enter') {
        if (currentGuess.length === 5) submitGuess();
        else showMessage("Palavra muito curta");
    }
});

function updateCurrentTiles() {
    const numBoards = document.querySelectorAll('.board').length;
    for (let i = 0; i < numBoards; i++) {
        const row = document.getElementById(`board-${i}-row-${currentRow}`);
        if (row.classList.contains('solved')) continue;

        const tiles = row.children;
        for (let c = 0; c < 5; c++) {
            tiles[c].innerText = currentGuess[c] || "";
            if (currentGuess[c]) tiles[c].setAttribute('data-status', 'filled');
            else tiles[c].removeAttribute('data-status');
        }
    }
}

async function submitGuess() {
    isAnimating = true;
    
    try {
        const response = await fetch('/api/guess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: currentGameId, guess: currentGuess })
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (response.status === 404) {
                showMessage("Jogo expirado. Reinicie a página.");
                isGameOver = true;
                return;
            }
            throw new Error(errorData.error || "Erro de conexão");
        }

        const data = await response.json();
        await animateResults(data.results);

        const currentMode = document.getElementById('game-area').dataset.mode;

        if (data.gameOver) {
            isGameOver = true;
            
            // LÓGICA DE FIM DE JOGO
            if (data.message) {
                // Ganhou
                showMessage(data.message);
                celebrateWin(data.results);
            } else {
                // Perdeu: Mostra a solução vinda do backend
                const resposta = data.solution ? data.solution.join(", ") : "???";
                showMessage(`Que pena! Era: ${resposta}`);
            }

            // Salva o bloqueio SÓ para este modo
            saveModeLock(currentMode);

        } else {
            currentRow++;
            // Se atingiu o limite de tentativas (Perdeu por tentativas)
            if (currentRow >= MAX_ATTEMPTS) {
                isGameOver = true;
                const resposta = data.solution ? data.solution.join(", ") : "???";
                showMessage(`Que pena! Era: ${resposta}`);
                
                saveModeLock(currentMode);
            } else {
                currentGuess = "";
                isAnimating = false;
            }
        }
    } catch (err) {
        showMessage(err.message || "Erro de conexão.");
        isAnimating = false;
    }
}

function animateResults(results) {
    return new Promise((resolve) => {
        const tilesToAnimate = [];
        let maxDelay = 0;
        
        results.forEach((res, boardIndex) => {
            if (!res.feedback) return; 

            const row = document.getElementById(`board-${boardIndex}-row-${currentRow}`);
            if (res.solved) row.classList.add('solved');
            const tiles = row.children;

            for (let i = 0; i < 5; i++) {
                const delay = i * 300;
                if (delay > maxDelay) maxDelay = delay;
                tilesToAnimate.push({
                    element: tiles[i],
                    colorClass: res.feedback[i],
                    delay: delay
                });
            }
        });

        if (tilesToAnimate.length === 0) { resolve(); return; }

        tilesToAnimate.forEach(item => {
            setTimeout(() => {
                item.element.classList.add('flip');
                setTimeout(() => {
                    item.element.classList.add(item.colorClass);
                    item.element.removeAttribute('data-status');
                    item.element.style.borderColor = 'transparent';
                }, 250);
            }, item.delay);
        });

        setTimeout(() => resolve(), maxDelay + 600);
    });
}

function celebrateWin(results) {
    setTimeout(() => {
        results.forEach((res, boardIndex) => {
            const row = document.getElementById(`board-${boardIndex}-row-${currentRow}`);
            for (let i = 0; i < 5; i++) {
                setTimeout(() => row.children[i].classList.add('win'), i * 100);
            }
        });
    }, 100);
}

function showMessage(msg) {
    const msgElem = document.getElementById('message');
    msgElem.innerText = msg;
    if (msg) {
        msgElem.classList.add('show');
        // Mensagem some se o jogo NÃO acabou. Se acabou, fica fixa para ler a resposta.
        if (!isGameOver) setTimeout(() => msgElem.classList.remove('show'), 3000);
    } else msgElem.classList.remove('show');
}

function toggleModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.toggle('hidden');
}

window.onclick = function(event) {
    const modal = document.getElementById('help-modal');
    if (event.target === modal) modal.classList.add('hidden');
}