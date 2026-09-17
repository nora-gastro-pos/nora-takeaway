import React from 'react';
import Menu from './Menu'; // Oder je nachdem, welche Ansicht du zuerst sehen willst

export default function App() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Nora Gastro – System Test</h1>
      <p>Die neue Supabase- & Vercel-Umgebung läuft erfolgreich!</p>
      <hr style={{ margin: '20px 0' }} />
      
      {/* Hier laden wir direkt eure bestehende Menu-Komponente */}
      <Menu />
    </div>
  );
}