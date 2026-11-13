const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8000;
const code = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 500;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/code', code);
app.get('/pair', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'pair.html'));
});
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'main.html'));
});

app.listen(PORT, () => {
    console.log(`Luzzy MD server running on http://localhost:${PORT}`);
});

module.exports = app;
