/**
 * Full-screen background scene + accent colours for the current section.
 * The new scene fades in over the previous one; only the scenes actually
 * visited are downloaded.
 */
import { useEffect, useState } from 'react';
import { getTheme } from './themes.js';
import { useColorMode } from './mode.js';

export default function Scene({ section }) {
  const theme = getTheme(section);
  const [mode] = useColorMode();
  const src = mode === 'light' ? `light/${theme.scene}` : theme.scene;
  const [layers, setLayers] = useState([src]);

  useEffect(() => {
    setLayers((l) => (l[l.length - 1] === src ? l : [l[l.length - 1], src]));
    const root = document.documentElement.style;
    root.setProperty('--accent', theme.accent);
    root.setProperty('--accent-2', theme.accent2);
    root.setProperty('--on-accent', theme.ink);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.accent);
  }, [theme, src]);

  return (
    <div className="scene" aria-hidden data-scene={theme.scene} data-mode={mode}>
      {layers.map((s) => (
        <div key={s} className="scene-layer" style={{ backgroundImage: `url(/backgrounds/${s}.jpg)` }} />
      ))}
    </div>
  );
}
