require('dotenv').config(); // Carrega as senhas do arquivo .env
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- CONFIGURAÇÃO DO E-MAIL (NOVO) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- VARIÁVEIS GLOBAIS ---
let PALAVRAS = []; // Banco de palavras do jogo
let visitasHoje = 0; // Contador de visitas (NOVO)
const activeGames = {};

// Configurações do Jogo
const TARGET_POOL_SIZE = 200;
const BATCH_SIZE = 50;

// ==================================================
//              LÓGICA DO JOGO (TERMO)
// ==================================================

// Função para buscar palavras
async function populateWordBank() {
    if (PALAVRAS.length >= TARGET_POOL_SIZE) return;

    console.log(`🔄 [JOGO] Buscando palavras... (Atual: ${PALAVRAS.length})`);

    const requests = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
        requests.push(axios.get('https://api.dicionario-aberto.net/random'));
    }

    try {
        const responses = await Promise.allSettled(requests);
        let newWordsCount = 0;

        responses.forEach(result => {
            if (result.status === 'fulfilled') {
                const palavraCrua = result.value.data.word;
                if (!palavraCrua) return;
                
                const palavraLimpa = palavraCrua
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                    .toUpperCase()
                    .replace(/[^A-Z]/g, "");

                if (palavraLimpa.length === 5 && !PALAVRAS.includes(palavraLimpa)) {
                    PALAVRAS.push(palavraLimpa);
                    newWordsCount++;
                }
            }
        });

        console.log(`✅ [JOGO] +${newWordsCount} palavras. Total: ${PALAVRAS.length}`);
        if (PALAVRAS.length < 20) populateWordBank(); 

    } catch (error) {
        console.error("❌ Erro API Dicionário:", error.message);
    }
}

// Inicializa palavras
populateWordBank();

// --- ROTAS DO JOGO ---

const generateGameId = () => Math.random().toString(36).substr(2, 9);

app.post('/api/start', async (req, res) => {
    if (PALAVRAS.length < 5) {
        await populateWordBank();
        if (PALAVRAS.length < 5) return res.status(503).json({ error: "Carregando dicionário..." });
    }

    const { mode } = req.body;
    let numWords = 1;
    if (mode === 'dueto') numWords = 2;
    if (mode === 'quarteto') numWords = 4;

    const gameId = generateGameId();
    const gameWords = [];

    let attempts = 0;
    while (gameWords.length < numWords && attempts < 200) {
        const randomWord = PALAVRAS[Math.floor(Math.random() * PALAVRAS.length)];
        if (!gameWords.includes(randomWord)) gameWords.push(randomWord);
        attempts++;
    }

    if (gameWords.length < numWords) return res.status(500).json({ error: "Erro ao gerar palavras." });

    activeGames[gameId] = {
        words: gameWords,
        mode: mode,
        finished: Array(numWords).fill(false)
    };

    console.log(`🎮 Jogo [${gameId}] (${mode}): ${gameWords.join(", ")}`);
    res.json({ gameId, mode });
});

app.post('/api/guess', (req, res) => {
    const { gameId, guess } = req.body;
    const game = activeGames[gameId];

    if (!game) return res.status(404).json({ error: "Jogo expirado. Recarregue a página." });

    const guessUpper = guess.toUpperCase();
    if (!guessUpper || guessUpper.length !== 5) {
         return res.status(400).json({ error: "A palavra precisa ter 5 letras" });
    }

    const results = [];
    game.words.forEach((secretWord, index) => {
        if (game.finished[index]) {
            results.push({ solved: true });
            return;
        }

        const feedback = checkWord(guessUpper, secretWord);
        if (guessUpper === secretWord) game.finished[index] = true;

        results.push({ feedback, solved: game.finished[index] });
    });

    const allSolved = game.finished.every(status => status === true);
    
    res.json({ 
        results, 
        gameOver: allSolved,
        message: allSolved ? getVictoryMessage(game.mode) : null,
        solution: game.words 
    });
});

// Funções auxiliares do jogo
function getVictoryMessage(mode) {
    if (mode === 'quarteto') return "UAU! Você dominou o Quarteto!";
    if (mode === 'dueto') return "Incrível! Dupla vencida!";
    return "Parabéns! Você acertou!";
}

function checkWord(guess, secret) {
    let result = Array(5).fill('gray');
    let secretArr = secret.split('');
    let guessArr = guess.split('');

    guessArr.forEach((letter, i) => {
        if (letter === secretArr[i]) {
            result[i] = 'green';
            secretArr[i] = null;
            guessArr[i] = null;
        }
    });
    guessArr.forEach((letter, i) => {
        if (letter && secretArr.includes(letter)) {
            result[i] = 'yellow';
            secretArr[secretArr.indexOf(letter)] = null;
        }
    });
    return result;
}

// ==================================================
//              LÓGICA DE ANALYTICS (NOVA)
// ==================================================

// Rota para contar visita (O Frontend chama isso ao carregar)
app.get('/api/visit', (req, res) => {
    visitasHoje++;
    console.log(`📈 Nova visita! Total hoje: ${visitasHoje}`);
    res.json({ success: true });
});

// ==================================================
//              AGENDAMENTOS (CRON JOBS)
// ==================================================

// 1. Meia-noite: Resetar palavras do jogo
cron.schedule('0 0 * * *', () => {
    console.log("⏰ Meia-noite! Renovando banco de palavras...");
    PALAVRAS = []; 
    populateWordBank();
});

// 2. 23:59: Enviar relatório de visitas por e-mail
cron.schedule('* * * * *', () => {
    console.log("📧 Enviando relatório diário de visitas...");
    
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER, // Manda para você mesmo
        subject: `📊 Termo Seguro - Relatório ${new Date().toLocaleDateString()}`,
        text: `Olá!\n\nHoje o seu jogo teve um total de: ${visitasHoje} visitas.\n\nParabéns!`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log('❌ Erro ao enviar email:', error);
        } else {
            console.log('✅ Email enviado: ' + info.response);
            visitasHoje = 0; // Zera para o dia seguinte
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log('Aguardando palavras da API...');
});