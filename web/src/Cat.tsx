import React, { useId } from 'react';
import type { Mood } from './market';

export function Cat({ mood = 'Smug', decorative = false, className = '' }: { mood?: Mood; decorative?: boolean; className?: string }) {
  const id = useId().replaceAll(':', '');
  const star = '0,-7 2.1,-2.4 7,-2.1 3.4,1.5 4.3,6.5 0,4 -4.3,6.5 -3.4,1.5 -7,-2.1 -2.1,-2.4';
  const crying = mood === 'Crying', grinning = mood === 'Grinning', content = mood === 'Content', grumpy = mood === 'Grumpy';
  return <svg className={`cat ${className}`} viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `Daemon the grey tabby looking ${mood.toLowerCase()}, in his pawnbroker’s visor and gold coin`}>
    {!decorative && <title>{`${mood} Daemon, the pawn shop cat`}</title>}
    <defs>
      <linearGradient id={`${id}gold`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#F6DA6B"/><stop offset=".5" stopColor="#D7A93A"/><stop offset="1" stopColor="#A97620"/></linearGradient>
      <radialGradient id={`${id}disc`} cx=".4" cy=".3" r=".8"><stop stopColor="#3459BF"/><stop offset="1" stopColor="#1F3D9E"/></radialGradient>
      <linearGradient id={`${id}fur`} x1="0" y1="0" x2=".6" y2="1"><stop stopColor="#AFB6C1"/><stop offset=".65" stopColor="#8F97A4"/><stop offset="1" stopColor="#747C8A"/></linearGradient>
      <clipPath id={`${id}clip`}><circle cx="200" cy="200" r="155"/></clipPath>
    </defs>
    <circle cx="200" cy="203" r="193" fill="#151515"/>
    <circle cx="200" cy="198" r="188" fill={`url(#${id}gold)`} stroke="#6E4F12" strokeWidth="5"/>
    <circle cx="200" cy="198" r="182" fill="none" stroke="#F6DA6B" strokeWidth="2"/>
    <circle cx="200" cy="198" r="164" fill="none" stroke="#6E4F12" strokeWidth="3"/>
    {Array.from({length: 16}, (_, i) => <polygon key={i} points={star} fill="#F6DA6B" stroke="#6E4F12" strokeWidth=".6" transform={`translate(${200 + 174 * Math.sin(i * Math.PI / 8)},${198 - 174 * Math.cos(i * Math.PI / 8)}) rotate(${i * 22.5})`}/>)}
    <circle cx="200" cy="198" r="155" fill={`url(#${id}disc)`} stroke="#151515" strokeWidth="4"/>
    <g clipPath={`url(#${id}clip)`} stroke="#151515" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
      <g opacity=".17" stroke="#F6DA6B" strokeWidth="2"><path d="M58 150h39m205 0h39M53 248h45m205 0h40M81 104l26 23m187 0 25-23M80 294l26-19m190 1 24 17"/><circle cx="200" cy="198" r="138" fill="none"/></g>
      <path d="M82 366q3-59 48-80l34-14h72l34 14q47 18 51 80" fill="#5E3B22"/>
      <path d="m159 275 42 74 39-74-39-17z" fill="#F5F0DF"/>
      <path d="m150 278 38 86-40-37 13-15-25-6zM246 278l-36 86 42-38-14-15 24-8z" fill="#795033"/>
      <path d="M104 348q7-29 21-40m169 40q-7-29-22-40" fill="none" stroke="#3B2518"/>
      <circle cx="204" cy="342" r="4" fill="#D7A93A" strokeWidth="2"/>
      <path d="M162 251v34q38 27 76 0v-34" fill="#8F97A4"/>
      <path d="M149 270q51 27 100 0l-1 17q-49 32-98-1z" fill="#B8322F"/>
      <g transform="rotate(8 215 301)"><path d="m207 287-9 13v30h27v-30l-9-13z" fill="#E9D9A6" strokeWidth="3"/><circle cx="212" cy="297" r="2" fill="#6E4F12" stroke="none"/><path d="M205 308h13m-13 6h13m-13 6h8" stroke="#6E4F12" strokeWidth="2"/></g>
      {crying ? <><path d="m125 150-43-22 17 62 40 4M276 150l43-22-17 62-40 4" fill="#8F97A4"/><path d="m100 148 7 25 22-7m172-18-7 25-22-7" fill="#D98A9A" strokeWidth="3"/></> : <><path d="m118 176-6-88q4-11 15-4l59 66m97 26 5-86q-5-11-15-3l-56 62" fill="#8F97A4"/><path d="m127 155-3-53 43 43m109 10 1-53-43 43" fill="#D98A9A" strokeWidth="3"/></>}
      <path d="M128 149q30-26 73-23 50-3 78 25l10 41 13 16-14 1 12 24-18-1q-4 40-52 55l-30 7-30-7q-47-13-54-53l-19 1 12-25-14-1 13-17z" fill={`url(#${id}fur)`}/>
      <path d="m181 137 9 26 9-21 10 20 9-27m-107 55 28 12-31 3m6 18 26 3-19 12m162-48-27 12 29 3m-7 18-25 3 19 12" stroke="#5B6270" strokeWidth="6" fill="none"/>
      <path d="M169 237q-16-8-22 5-7 20 27 30 16 9 27-3 13 12 29 3 32-9 26-28-5-15-26-7" fill="#D3D8DF" stroke="none"/>
      {crying ? <>
        <path d="m140 206 16-7 14 8m60 0 15-8 15 7" fill="none" strokeWidth="6"/>
        <path d="M146 211q-3 13-8 24t7 17q15-2 9-15l-2-26M249 211q3 13 8 24t-7 17q-15-2-9-15l2-26" fill="#88CCED" stroke="#151515" strokeWidth="2"/>
        <path d="M182 260q18-15 37 0" fill="none"/>
      </> : content ? <>
        <path d="M138 209q17-24 35 0m55 0q17-24 35 0" fill="none" strokeWidth="5"/>
        <ellipse cx="144" cy="234" rx="13" ry="6" fill="#D98A9A" opacity=".7" stroke="none"/><ellipse cx="257" cy="234" rx="13" ry="6" fill="#D98A9A" opacity=".7" stroke="none"/>
        <path d="M182 252q19 19 39 0" fill="none"/>
      </> : grinning ? <>
        <ellipse cx="156" cy="205" rx="23" ry="25" fill="#CBD84B"/><ellipse cx="246" cy="205" rx="23" ry="25" fill="#CBD84B"/>
        <ellipse cx="160" cy="206" rx="5" ry="17" fill="#151515" stroke="none"/><ellipse cx="242" cy="206" rx="5" ry="17" fill="#151515" stroke="none"/>
        <path d="m145 192 4-8 3 8 8 3-8 3-3 8-4-8-7-3zM249 192l4-8 3 8 8 3-8 3-3 8-4-8-7-3z" fill="#fff" stroke="none"/>
        <path d="M174 248q26 9 55 0-3 36-28 35-24 0-27-35z" fill="#40242B"/>
        <path d="m182 252 5 13 8-12m14 0 8 12 6-13" fill="#F5F0DF" strokeWidth="2"/>
        <path d="M190 274q12-7 22 0" fill="none" stroke="#D98A9A" strokeWidth="7"/>
      </> : <>
        <path d="M132 200q19-17 48 0-1 28-25 28-24 0-23-28zM223 200q24-17 47 0-2 28-24 28-24 0-23-28z" fill="#CBD84B"/>
        <ellipse cx={grumpy ? 156 : 169} cy="210" rx="4" ry="16" fill="#151515" stroke="none"/><ellipse cx={grumpy ? 246 : 258} cy="210" rx="4" ry="16" fill="#151515" stroke="none"/>
        <path d={grumpy ? 'M130 190q27 2 52 19l-50-3zM220 209q25-16 53-19l-3 16z' : 'M130 190q25-5 51 5l-2 12-48-1zM221 197q24-10 53-6l-3 15-49 4z'} fill="#8F97A4"/>
        <path d={grumpy ? 'M182 262q19-18 40-2' : 'M181 252q16 20 45-2m-2-5 5 11'} fill="none"/>
      </>}
      <path d="M190 232q10-5 22 0l-10 9z" fill="#D98A9A" strokeWidth="3"/>
      <path d="M201 241v8" fill="none" strokeWidth="3"/>
      <g strokeWidth="2.5"><path d="m149 244-45-9m44 16-47 5m153-12 44-9m-43 16 46 5"/><path d="m165 240 1 1m7 3 1 1m60-4 1 1m6 3 1 1"/></g>
      <g transform={crying ? 'rotate(17 201 160)' : grinning ? 'rotate(-9 201 146) translate(0 -10)' : 'rotate(-5 201 158)'}>
        <path d="M136 149q5-43 66-42 54 0 65 38l-12 19-107 1z" fill="#1F7A45"/>
        <path d="M137 148q61-15 129-2l5 16q-69-14-137 4z" fill="#144C31"/>
        <path d="M140 158q54-9 135-1 20 3 28 16-72 22-120 0l-45-5z" fill="#2E9A5B"/>
        <path d="M165 126q30-14 58-6" fill="none" stroke="#63B97A" strokeWidth="3"/>
      </g>
    </g>
    <circle cx="200" cy="198" r="155" fill="none" stroke="#151515" strokeWidth="4"/>
    <path d="M80 83a168 168 0 0 1 190-33" stroke="#FFF0A8" opacity=".55" strokeWidth="3" fill="none" strokeLinecap="round"/>
  </svg>;
}
