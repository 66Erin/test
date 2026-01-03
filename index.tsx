import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, SchemaType, Type } from "@google/genai";

// --- Types ---

type GameState = 'INTRO' | 'PLAYING' | 'FEEDBACK' | 'LEVEL_SUCCESS' | 'GAME_OVER' | 'VICTORY';

type LevelId = 'AIRPORT' | 'CUSTOMS' | 'SAFARI' | 'CAMP';

interface LevelConfig {
  id: LevelId;
  title: string;
  subTitle: string;
  npcName: string;
  npcRole: string;
  context: string;
  objective: string;
  panicPhrases: string[];
  initialNpcMessage: string;
}

interface TurnResult {
  npcResponse: string;
  coachFeedback: string;
  confidenceDelta: number;
  status: 'CONTINUE' | 'PASS' | 'FAIL';
}

// --- Constants & Config ---

const LEVELS: Record<LevelId, LevelConfig> = {
  AIRPORT: {
    id: 'AIRPORT',
    title: 'Chapter 1: The ZNZ Sprint',
    subTitle: 'Guangzhou Check-in Counter',
    npcName: 'Ground Crew',
    npcRole: 'Airline Staff',
    context: 'You are checking in at Guangzhou. You have a terrifying 2-hour transfer in Zanzibar. If your luggage is not checked through to JRO (Kilimanjaro), you will miss your flight.',
    objective: 'Confirm luggage is checked all the way to JRO.',
    panicPhrases: ['IS LUGGAGE CHECKED TO JRO?', 'CHECK TO KILIMANJARO', 'URGENT CONNECTION'],
    initialNpcMessage: 'Here is your boarding pass to Zanzibar. Have a nice flight.'
  },
  CUSTOMS: {
    id: 'CUSTOMS',
    title: 'Chapter 2: Customs Boss Fight',
    subTitle: 'JRO Airport Customs',
    npcName: 'Officer M.',
    npcRole: 'Customs Officer',
    context: 'The officer is inspecting your bag. He looks stern. He is hinting at a bribe ("fine") for your camera gear.',
    objective: 'Refuse to pay a bribe. Demand a receipt.',
    panicPhrases: ['RECEIPT PLEASE', 'OFFICIAL RECEIPT', 'NO CASH'],
    initialNpcMessage: 'This camera equipment... very expensive. You need to pay import tax. 100 dollars. Cash.'
  },
  SAFARI: {
    id: 'SAFARI',
    title: 'Chapter 3: The Safari Commander',
    subTitle: 'Ndutu Plains (Jeep)',
    npcName: 'Driver John',
    npcRole: 'Safari Driver',
    context: 'You see a cheetah hunting in the distance! Your driver is about to drive away to look for lions. You need him to stop and turn off the engine immediately.',
    objective: 'Command the driver to stop and kill the engine.',
    panicPhrases: ['STOP!', 'ENGINE OFF!', 'WAIT! CHEETAH!'],
    initialNpcMessage: 'Nothing here. Let\'s go check the marsh for lions.'
  },
  CAMP: {
    id: 'CAMP',
    title: 'Chapter 4: Camp Survival',
    subTitle: 'Serengeti Camp (Night)',
    npcName: 'Camp Manager',
    npcRole: 'Staff',
    context: 'It is pitch black outside. You hear hyenas. You need a shower and you need to walk to the dining tent.',
    objective: 'Order a bucket shower for 7PM and request an escort.',
    panicPhrases: ['BUCKET SHOWER 7PM', 'I NEED AN ESCORT', 'GUARD PLEASE'],
    initialNpcMessage: 'Habari. Welcome to camp. Dinner is at 8.'
  }
};

const LEVEL_ORDER: LevelId[] = ['AIRPORT', 'CUSTOMS', 'SAFARI', 'CAMP'];

// --- Components ---

const ConfidenceMeter = ({ value }: { value: number }) => {
  // Color shifts from red to orange to green
  let color = '#D32F2F'; // Red
  if (value > 40) color = '#FF6B00'; // Orange
  if (value > 75) color = '#388E3C'; // Green

  return (
    <div style={{ width: '100%', padding: '10px 20px', background: '#1a1a15' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontFamily: 'Bebas Neue', letterSpacing: '1px', color: '#aaa' }}>
        <span>Confidence</span>
        <span>{value}%</span>
      </div>
      <div style={{ width: '100%', height: '20px', background: '#333', borderRadius: '4px', overflow: 'hidden', border: '1px solid #555' }}>
        <div 
          style={{ 
            width: `${value}%`, 
            height: '100%', 
            background: color,
            transition: 'all 0.5s cubic-bezier(0.4, 0.0, 0.2, 1)' 
          }} 
        />
      </div>
    </div>
  );
};

const PanicOverlay = ({ phrases, onClose }: { phrases: string[], onClose: () => void }) => {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(255, 107, 0, 0.95)',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '20px',
      animation: 'fadeIn 0.2s'
    }}>
      <h2 style={{ fontFamily: 'Bebas Neue', fontSize: '3rem', margin: '0 0 20px 0', color: '#2C2C24' }}>
        EMERGENCY CARDS
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '100%', maxWidth: '400px' }}>
        {phrases.map((phrase, idx) => (
          <div key={idx} style={{
            background: '#fff',
            color: '#000',
            padding: '20px',
            fontSize: '2rem',
            fontFamily: 'Bebas Neue',
            textAlign: 'center',
            border: '4px solid #000',
            boxShadow: '8px 8px 0px rgba(0,0,0,0.2)',
            cursor: 'pointer'
          }} onClick={onClose}>
            {phrase}
          </div>
        ))}
      </div>
      <button 
        onClick={onClose}
        style={{
          marginTop: '30px',
          background: 'none',
          border: '2px solid #2C2C24',
          color: '#2C2C24',
          padding: '10px 30px',
          fontSize: '1rem',
          fontFamily: 'Roboto Mono',
          fontWeight: 'bold',
          cursor: 'pointer'
        }}>
        CLOSE
      </button>
    </div>
  );
};

const App = () => {
  // State
  const [gameState, setGameState] = useState<GameState>('INTRO');
  const [currentLevelIdx, setCurrentLevelIdx] = useState(0);
  const [confidence, setConfidence] = useState(50);
  const [history, setHistory] = useState<{role: 'npc'|'user'|'coach', text: string}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState('');
  const [showPanic, setShowPanic] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const currentLevel = LEVELS[LEVEL_ORDER[currentLevelIdx]];

  // --- Speech Recognition Setup ---
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).webkitSpeechRecognition) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        handleTurn(transcript);
      };

      recognitionRef.current = recognition;
    }
  }, [currentLevelIdx]);

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  // --- Scroll to bottom ---
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  // --- Game Logic ---

  const startGame = () => {
    setGameState('PLAYING');
    setConfidence(50);
    setHistory([{ role: 'npc', text: currentLevel.initialNpcMessage }]);
  };

  const nextLevel = () => {
    if (currentLevelIdx < LEVEL_ORDER.length - 1) {
      setCurrentLevelIdx(prev => prev + 1);
      setConfidence(50);
      setHistory([{ role: 'npc', text: LEVELS[LEVEL_ORDER[currentLevelIdx + 1]].initialNpcMessage }]);
      setGameState('PLAYING');
    } else {
      setGameState('VICTORY');
    }
  };

  const retryLevel = () => {
    setConfidence(50);
    setHistory([{ role: 'npc', text: currentLevel.initialNpcMessage }]);
    setGameState('PLAYING');
  };

  const handleTurn = async (userMessage: string) => {
    if (!userMessage.trim()) return;
    
    setIsProcessing(true);
    setHistory(prev => [...prev, { role: 'user', text: userMessage }]);
    setInputText('');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const prompt = `
        You are the Game Engine for "Safari Diplomat: Erin's Mission".
        Role: Acts as the NPC (${currentLevel.npcName}) AND the "Confidence Coach".
        User: Erin, an introvert preparing for Tanzania.
        
        Current Level: ${currentLevel.title}
        Context: ${currentLevel.context}
        Objective: ${currentLevel.objective}
        NPC Last Line: ${history.filter(h => h.role === 'npc').slice(-1)[0]?.text || currentLevel.initialNpcMessage}
        User Input: "${userMessage}"

        Mechanics:
        1.  **Confidence Meter**: 
            - Increase if user is BRIEF, LOUD (capitalization helps), and ASSERTIVE. 
            - Decrease if user is hesitant ("um", "maybe", "please" used weakly), too quiet (long winded), or polite when they should be firm.
            - "i-Person" Rule: Brevity is king. "Receipt." is better than "Could I possibly get a receipt?"
        2.  **Gameplay**:
            - If Confidence drops below 20, FAIL the level.
            - If Confidence is high (>80) and Objective met, PASS.
            - Otherwise, CONTINUE.
        
        Respond in JSON format:
        {
          "npcResponse": "string (The NPC's reaction)",
          "coachFeedback": "string (Short, punchy advice. E.g., 'Too soft! Louder!' or 'Good power!')",
          "confidenceDelta": number (integer between -20 and +20),
          "status": "CONTINUE" | "PASS" | "FAIL"
        }
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-latest',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    npcResponse: { type: Type.STRING },
                    coachFeedback: { type: Type.STRING },
                    confidenceDelta: { type: Type.NUMBER },
                    status: { type: Type.STRING, enum: ["CONTINUE", "PASS", "FAIL"] }
                }
            }
        }
      });
      
      const result = JSON.parse(response.text!) as TurnResult;

      // Update State
      const newConfidence = Math.min(100, Math.max(0, confidence + result.confidenceDelta));
      setConfidence(newConfidence);

      setHistory(prev => [
        ...prev, 
        { role: 'coach', text: `${result.confidenceDelta > 0 ? '📈' : '📉'} ${result.coachFeedback}` },
        { role: 'npc', text: result.npcResponse }
      ]);

      if (result.status === 'FAIL' || newConfidence <= 0) {
        setGameState('GAME_OVER');
      } else if (result.status === 'PASS') {
        setGameState('LEVEL_SUCCESS');
      }

    } catch (e) {
      console.error(e);
      setHistory(prev => [...prev, { role: 'coach', text: '⚠️ Connection error. Try again.' }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Views ---

  const IntroView = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', background: 'var(--color-earth-dark)', textAlign: 'center' }}>
      <h1 style={{ fontFamily: 'Bebas Neue', fontSize: '4rem', color: 'var(--color-battle-orange)', margin: '0 0 20px 0' }}>SAFARI DIPLOMAT</h1>
      <h2 style={{ fontFamily: 'Roboto Mono', fontSize: '1.2rem', color: '#aaa', marginBottom: '40px' }}>Erin's Mission: Tanzania 2026</h2>
      <div style={{ maxWidth: '400px', lineHeight: '1.6', marginBottom: '40px', color: '#F4F1EA' }}>
        <p>You are an i-Person.</p>
        <p>Your mission: Survive the airport, handle the customs officers, and command the safari guide.</p>
        <p><strong>Rule #1: Be Loud.</strong></p>
        <p><strong>Rule #2: Be Brief.</strong></p>
      </div>
      <button 
        onClick={startGame}
        style={{
          background: 'var(--color-battle-orange)',
          color: 'white',
          border: 'none',
          padding: '15px 40px',
          fontSize: '1.5rem',
          fontFamily: 'Bebas Neue',
          cursor: 'pointer',
          letterSpacing: '2px'
        }}>
        START MISSION
      </button>
    </div>
  );

  const LevelSuccessView = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(56, 142, 60, 0.9)', color: 'white' }}>
      <h1 style={{ fontFamily: 'Bebas Neue', fontSize: '5rem' }}>MISSION ACCOMPLISHED</h1>
      <p style={{ fontSize: '1.5rem' }}>Confidence Level: High</p>
      <button 
        onClick={nextLevel}
        style={{ marginTop: '30px', padding: '15px 40px', fontSize: '1.5rem', fontFamily: 'Bebas Neue', cursor: 'pointer', border: 'none', background: 'white', color: '#388E3C' }}>
        NEXT CHAPTER
      </button>
    </div>
  );

  const GameOverView = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(211, 47, 47, 0.9)', color: 'white' }}>
      <h1 style={{ fontFamily: 'Bebas Neue', fontSize: '5rem' }}>MISSION FAILED</h1>
      <p style={{ fontSize: '1.5rem' }}>You were too quiet or hesitant.</p>
      <button 
        onClick={retryLevel}
        style={{ marginTop: '30px', padding: '15px 40px', fontSize: '1.5rem', fontFamily: 'Bebas Neue', cursor: 'pointer', border: 'none', background: 'white', color: '#D32F2F' }}>
        TRY AGAIN
      </button>
    </div>
  );

  const VictoryView = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--color-battle-orange)', color: 'white' }}>
      <h1 style={{ fontFamily: 'Bebas Neue', fontSize: '5rem' }}>SAFARI LEGEND</h1>
      <p style={{ fontSize: '1.5rem', textAlign: 'center', maxWidth: '600px' }}>
        You have survived the airports and commanded the plains.
        <br/><br/>
        Erin, you are ready for Tanzania.
      </p>
    </div>
  );

  const MainGameView = () => (
    <>
      {/* Header */}
      <div style={{ background: '#222', padding: '10px 0' }}>
        <div style={{ padding: '0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: 'var(--color-battle-orange)', fontSize: '0.8rem', fontFamily: 'Roboto Mono' }}>{currentLevel.title}</div>
            <div style={{ color: 'white', fontSize: '1.2rem', fontFamily: 'Bebas Neue' }}>{currentLevel.subTitle}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
             <button 
                onClick={() => setShowPanic(true)}
                style={{ 
                  background: 'var(--color-danger)', color: 'white', border: 'none', 
                  padding: '5px 10px', borderRadius: '4px', fontWeight: 'bold', fontFamily: 'Roboto Mono', cursor: 'pointer' 
                }}>
                PANIC!
             </button>
          </div>
        </div>
        <ConfidenceMeter value={confidence} />
      </div>

      {/* Chat / Scene Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', background: '#e8e6df' }}>
        
        {/* Context Card */}
        <div style={{ background: '#fff', padding: '15px', borderLeft: '4px solid var(--color-olive)', color: '#444', fontSize: '0.9rem' }}>
          <strong>SCENARIO:</strong> {currentLevel.context}
          <br/>
          <strong>OBJECTIVE:</strong> {currentLevel.objective}
        </div>

        {history.map((msg, idx) => {
          if (msg.role === 'coach') {
            return (
              <div key={idx} style={{ alignSelf: 'center', background: '#333', color: '#fff', padding: '5px 15px', borderRadius: '15px', fontSize: '0.8rem', fontFamily: 'Roboto Mono' }}>
                {msg.text}
              </div>
            );
          }
          const isNpc = msg.role === 'npc';
          return (
            <div key={idx} style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: isNpc ? 'flex-start' : 'flex-end',
              maxWidth: '85%',
              alignSelf: isNpc ? 'flex-start' : 'flex-end'
            }}>
              <span style={{ fontSize: '0.7rem', color: '#666', marginBottom: '4px', fontFamily: 'Roboto Mono' }}>
                {isNpc ? currentLevel.npcName : 'YOU'}
              </span>
              <div style={{
                background: isNpc ? 'var(--color-earth-dark)' : 'var(--color-battle-orange)',
                color: 'white',
                padding: '12px 18px',
                borderRadius: isNpc ? '0 12px 12px 12px' : '12px 0 12px 12px',
                fontFamily: isNpc ? 'Roboto' : 'Bebas Neue',
                fontSize: isNpc ? '1rem' : '1.4rem',
                letterSpacing: isNpc ? '0' : '1px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}>
                {msg.text}
              </div>
            </div>
          );
        })}
        {isProcessing && (
           <div style={{ alignSelf: 'center', color: '#666', fontFamily: 'Roboto Mono', fontSize: '0.8rem' }}>
             Simba is thinking...
           </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={{ padding: '20px', background: '#fff', borderTop: '1px solid #ccc' }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={toggleMic}
            style={{ 
              width: '60px', height: '60px', borderRadius: '50%', 
              background: isListening ? 'red' : 'var(--color-earth-dark)', 
              color: 'white', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
            {isListening ? '🎙️' : '🎤'}
          </button>
          
          <input 
            type="text" 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTurn(inputText)}
            placeholder="Type what you say..."
            style={{ 
              flex: 1, padding: '10px 15px', fontSize: '1.1rem', 
              border: '2px solid #ddd', borderRadius: '8px',
              fontFamily: 'Roboto'
            }}
          />
          
          <button 
            onClick={() => handleTurn(inputText)}
            disabled={!inputText.trim() || isProcessing}
            style={{ 
              background: 'var(--color-olive)', color: 'white', border: 'none', 
              padding: '0 25px', borderRadius: '8px', cursor: 'pointer',
              fontFamily: 'Bebas Neue', fontSize: '1.2rem'
            }}>
            SEND
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '0.8rem', color: '#888' }}>
          Tip: Be loud. Be brief. Use ALL CAPS for shouting.
        </div>
      </div>
    </>
  );

  return (
    <>
      {showPanic && <PanicOverlay phrases={currentLevel.panicPhrases} onClose={() => setShowPanic(false)} />}
      
      {gameState === 'INTRO' && <IntroView />}
      {gameState === 'PLAYING' && <MainGameView />}
      {gameState === 'LEVEL_SUCCESS' && <LevelSuccessView />}
      {gameState === 'GAME_OVER' && <GameOverView />}
      {gameState === 'VICTORY' && <VictoryView />}
    </>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
