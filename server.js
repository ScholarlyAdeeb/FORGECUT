const express = require('express');
const app = express();

// Required security headers for FFmpeg.wasm to use the browser's local memory
app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
});

// Serve everything inside the "public" folder
app.use(express.static('public'));

app.listen(3000, () => {
    console.log('ForgeCut running at http://localhost:3000');
});