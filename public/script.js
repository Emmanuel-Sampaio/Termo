let currentGameId = null;
let currentRow = 0;
let currentGuess = "";
let isGameOver = false;
let currentResults = []; 
let isAnimating = false;
const MAX_ATTEMPTS = 9;

window.onload = () => {
    fetch('/api/visit').catch(() => {});
    createKeyboard();
    updateLockedButtons();

    // --- BLOCO NOVO: Verifica se já jogou e mostra o popup ---
    const lastGame = JSON.parse(localStorage.getItem('termo_last_result'));
    const today = new Date().toDateString();

    if (lastGame && lastGame.date === today) {
        
        currentResults = lastGame.results; 
        currentGameId = lastGame.gameId;
        
        
        showFullLockScreen(); 
        
                setTimeout(() => {
            const title = lastGame.win ? "VITÓRIA!" : "FIM DE JOGO";
            const msg = `A resposta era: ${lastGame.solution.join(", ")}`;
            showResultModal(title, msg);
        }, 500);
        
        return; 
    }
    // ---------------------------------------------------------

    if (!isModeLocked('termo')) startGame('termo');
    else if (!isModeLocked('dueto')) startGame('dueto');
    else if (!isModeLocked('quarteto')) startGame('quarteto');
    else showFullLockScreen();
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

/* Substitua a função submitGuess inteira por esta: */

async function submitGuess() {
    isAnimating = true;
    
    try {
        const response = await fetch('/api/guess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: currentGameId, guess: currentGuess })
        });

        if (!response.ok) throw new Error();

        const data = await response.json();
        
                currentResults.push(data.results);
        if (typeof updateKeyColors === "function") {
            updateKeyColors(currentGuess, data.results); 
        }
        // -------------------------------------------------

        await animateResults(data.results);

        const currentMode = document.getElementById('game-area').dataset.mode;

        if (data.gameOver) {
            isGameOver = true;
            saveModeLock(currentMode);
            
           
            if (typeof showResultModal === "function") {
                if (data.message) {
                    celebrateWin(data.results);
                    setTimeout(() => showResultModal("VITÓRIA!", "Parabéns, você acertou!"), 1500);
                } else {
                    const resposta = data.solution ? data.solution.join(", ") : "???";
                    setTimeout(() => showResultModal("FIM DE JOGO", `A resposta era: ${resposta}`), 1000);
                }
            } else {
                
                showMessage(data.message || `Resposta: ${data.solution}`);
            }
            // -----------------------------------

        } else {
            currentRow++;
            if (currentRow >= MAX_ATTEMPTS) {
                isGameOver = true;
                saveModeLock(currentMode);
                const resposta = data.solution ? data.solution.join(", ") : "???";
                
                
                if (typeof showResultModal === "function") {
                    setTimeout(() => showResultModal("FIM DE JOGO", `A resposta era: ${resposta}`), 1000);
                } else {
                    showMessage(`A resposta era: ${resposta}`);
                }
            } else {
                currentGuess = "";
                isAnimating = false;
            }
        }
    } catch (err) {
        console.error(err);
        showMessage("Erro de conexão");
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
// --- FUNÇÕES DO TECLADO VIRTUAL ---
function createKeyboard() {
    const keys = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
    const container = document.getElementById('keyboard');
    container.innerHTML = '';

    keys.forEach((row, i) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'key-row';

        if (i === 2) { // Adiciona Enter na última linha
            const enter = document.createElement('button');
            enter.className = 'key wide';
            enter.innerText = 'ENTER';
            enter.onclick = () => handleKey('Enter');
            rowDiv.appendChild(enter);
        }

        row.split('').forEach(char => {
            const btn = document.createElement('button');
            btn.className = 'key';
            btn.id = `key-${char}`;
            btn.innerText = char;
            btn.onclick = () => handleKey(char);
            rowDiv.appendChild(btn);
        });

        if (i === 2) { // Adiciona Backspace na última linha
            const back = document.createElement('button');
            back.className = 'key wide';
            back.innerText = '⌫';
            back.onclick = () => handleKey('Backspace');
            rowDiv.appendChild(back);
        }
        container.appendChild(rowDiv);
    });
}

function handleKey(key) {
    if (isGameOver || isAnimating) return;

    if (key === 'Enter') {
        if (currentGuess.length === 5) submitGuess();
        else showMessage("Muito curta");
    } else if (key === 'Backspace') {
        currentGuess = currentGuess.slice(0, -1);
        updateCurrentTiles();
    } else if (/^[A-Z]$/.test(key)) {
        if (currentGuess.length < 5) {
            currentGuess += key;
            updateCurrentTiles();
        }
    }
}

// Atualiza cores do teclado virtual
function updateKeyColors(guess, feedbacks) {
    const letters = guess.split('');
    feedbacks.forEach(boardResult => {
        if (!boardResult.feedback) return;
        boardResult.feedback.forEach((status, i) => {
            const keyBtn = document.getElementById(`key-${letters[i]}`);
            if (keyBtn) {
                // A cor verde tem prioridade sobre amarelo, que tem prioridade sobre cinza
                if (keyBtn.classList.contains('green')) return;
                if (keyBtn.classList.contains('yellow') && status === 'gray') return;
                
                keyBtn.className = `key ${status}`;
            }
        });
    });
}

// --- FUNÇÃO DE COMPARTILHAR ---
function shareResult() {
    let text = `Termo Blindado #${currentGameId || 'Diário'} ${currentRow}/9\n`;
    
    // Gera os emojis
    currentResults.forEach(turn => {
        // Pega apenas o primeiro board para simplificar o share (ou combina se for dueto)
        // Aqui vou simplificar mostrando os emojis do primeiro board
        const res = turn[0]; 
        if (res.solved) text += "🟩🟩🟩🟩🟩\n";
        else if (res.feedback) {
            text += res.feedback.map(c => c === 'green' ? '🟩' : c === 'yellow' ? '🟨' : '⬛').join("") + "\n";
        }
    });

    text += "\nJogue em: https://termo-blindado.onrender.com";

    navigator.clipboard.writeText(text).then(() => {
        showMessage("Copiado! Cole no Twitter/Zap");
    }).catch(() => {
        showMessage("Erro ao copiar");
    });
}

function showResultModal(title, solution) {
    document.getElementById('result-title').innerText = title;
    document.getElementById('result-solution').innerText = solution;
    toggleModal('result-modal');
}