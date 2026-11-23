import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { applyMode } from './core/ui/mode.js';
import { installStaleChunkHandler } from './core/ui/staleChunk.js';
import './styles/global.css';

applyMode();
installStaleChunkHandler();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
