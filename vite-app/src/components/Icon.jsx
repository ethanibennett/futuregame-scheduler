import React from 'react';

const Icon = {
  search: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
  ),
  filter: () => (
    <svg data-icon viewBox="0 0 24 24" fill="currentColor"><g transform="scale(0.300000) translate(-10,-10)">
      <path d="M79.93,28.82H45.04c-0.83,0-1.5-0.67-1.5-1.5s0.67-1.5,1.5-1.5h34.89c0.83,0,1.5,0.67,1.5,1.5S80.76,28.82,79.93,28.82z"/><path d="M28.77,28.82h-8.71c-0.83,0-1.5-0.67-1.5-1.5s0.67-1.5,1.5-1.5h8.71c0.83,0,1.5,0.67,1.5,1.5S29.6,28.82,28.77,28.82z"/><path d="M36.92,36.95c-5.32,0-9.64-4.32-9.64-9.63c0-5.32,4.32-9.64,9.64-9.64c5.31,0,9.63,4.32,9.63,9.64 C46.54,32.63,42.23,36.95,36.92,36.95z M36.92,20.68c-3.66,0-6.64,2.98-6.64,6.64c0,3.66,2.98,6.63,6.64,6.63 c3.66,0,6.63-2.97,6.63-6.63C43.54,23.66,40.57,20.68,36.92,20.68z"/><path d="M79.93,51.5H67.04c-0.83,0-1.5-0.67-1.5-1.5s0.67-1.5,1.5-1.5h12.89c0.83,0,1.5,0.67,1.5,1.5S80.76,51.5,79.93,51.5z"/><path d="M50.77,51.5H20.06c-0.83,0-1.5-0.67-1.5-1.5s0.67-1.5,1.5-1.5h30.71c0.83,0,1.5,0.67,1.5,1.5S51.6,51.5,50.77,51.5z"/><path d="M58.92,59.63c-5.32,0-9.64-4.32-9.64-9.63c0-5.32,4.32-9.64,9.64-9.64c5.31,0,9.63,4.32,9.63,9.64 C68.54,55.31,64.22,59.63,58.92,59.63z M58.92,43.36c-3.66,0-6.64,2.98-6.64,6.64c0,3.66,2.98,6.63,6.64,6.63 c3.66,0,6.63-2.97,6.63-6.63C65.54,46.34,62.57,43.36,58.92,43.36z"/><path d="M79.93,74.18H49.04c-0.83,0-1.5-0.67-1.5-1.5s0.67-1.5,1.5-1.5h30.89c0.83,0,1.5,0.67,1.5,1.5S80.76,74.18,79.93,74.18z"/><path d="M32.77,74.18H20.06c-0.83,0-1.5-0.67-1.5-1.5s0.67-1.5,1.5-1.5h12.71c0.83,0,1.5,0.67,1.5,1.5S33.6,74.18,32.77,74.18z"/><path d="M40.92,82.32c-5.32,0-9.64-4.33-9.64-9.64c0-5.31,4.32-9.63,9.64-9.63c5.31,0,9.63,4.32,9.63,9.63 C50.54,78,46.23,82.32,40.92,82.32z M40.92,66.05c-3.66,0-6.64,2.97-6.64,6.63c0,3.66,2.98,6.64,6.64,6.64 c3.66,0,6.63-2.98,6.63-6.64C47.54,69.02,44.57,66.05,40.92,66.05z"/>
    </g></svg>
  ),
  list: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/>
      <line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/>
    </svg>
  ),
  calendar: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  star: (filled) => (
    <svg data-icon viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  upload: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  chevLeft: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  chevRight: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  warn: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  clock: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  empty: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  ),
  logout: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  sun: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ),
  moon: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  ),
  sunset: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 14a6 6 0 00-12 0"/>
      <line x1="12" y1="2" x2="12" y2="5"/>
      <line x1="4.93" y1="5.93" x2="6.34" y2="7.34"/>
      <line x1="19.07" y1="5.93" x2="17.66" y2="7.34"/>
      <line x1="1" y1="14" x2="4" y2="14"/>
      <line x1="20" y1="14" x2="23" y2="14"/>
      <line x1="2" y1="18" x2="22" y2="18"/>
      <line x1="4" y1="22" x2="20" y2="22"/>
    </svg>
  ),
  cloud: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
    </svg>
  ),
  signal: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.636 18.364a9 9 0 010-12.728"/>
      <path d="M18.364 5.636a9 9 0 010 12.728"/>
      <path d="M8.464 15.536a5 5 0 010-7.072"/>
      <path d="M15.536 8.464a5 5 0 010 7.072"/>
      <circle cx="12" cy="12" r="1.5"/>
    </svg>
  ),
  tracking: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  user: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  condition: () => (
    <svg data-icon viewBox="0 0 24 24" fill="currentColor"><g transform="scale(0.292683) translate(-9,-7)">
      <path d="M81.08,15.66H71.19V12.08a4.5,4.5,0,0,0-4.5-4.5H29.31a4.5,4.5,0,0,0-4.5,4.5V22.24a4.51,4.51,0,0,0,4.5,4.5H66.69a4.51,4.51,0,0,0,4.5-4.5V18.66h9.89a2.61,2.61,0,0,1,2.61,2.61V43.89a2.61,2.61,0,0,1-2.61,2.61H78.56a1.5,1.5,0,0,0,0,3h2.52a5.61,5.61,0,0,0,5.61-5.61V21.27A5.61,5.61,0,0,0,81.08,15.66Zm-24.77,3H39.69a1.5,1.5,0,0,1,0-3H56.31a1.5,1.5,0,0,1,0,3ZM68.66,42.87,50.28,34.7a5.58,5.58,0,0,0-4.56,0L27.34,42.87a5.61,5.61,0,0,0,0,10.26L45.72,61.3a5.65,5.65,0,0,0,4.56,0l18.38-8.17a5.61,5.61,0,0,0,0-10.26ZM56.31,49.5H39.69a1.5,1.5,0,0,1,0-3H56.31a1.5,1.5,0,0,1,0,3ZM66.69,69.26H29.31a4.51,4.51,0,0,0-4.5,4.5v3.58H14.92a2.61,2.61,0,0,1-2.61-2.61V52.11a2.61,2.61,0,0,1,2.61-2.61h2.52a1.5,1.5,0,0,0,0-3H14.92a5.61,5.61,0,0,0-5.61,5.61V74.73a5.61,5.61,0,0,0,5.61,5.61h9.89v3.58a4.5,4.5,0,0,0,4.5,4.5H66.69a4.5,4.5,0,0,0,4.5-4.5V73.76A4.51,4.51,0,0,0,66.69,69.26ZM56.31,80.34H39.69a1.5,1.5,0,0,1,0-3H56.31a1.5,1.5,0,0,1,0,3Z"/>
    </g></svg>
  ),
  crosshairs: () => (
    <svg data-icon viewBox="0 0 24 24" fill="currentColor"><g transform="scale(0.071856) translate(0,0)">
      <path d="M174.32 292.33c31.72,-1.91 60.27,-15.55 81.37,-36.64 21.09,-21.1 34.74,-49.65 36.64,-81.37l-30.53 0c-1.85,23.3 -12.07,44.25 -27.65,59.83 -15.58,15.58 -36.53,25.8 -59.83,27.65l0 30.53zm72.11 -118.01l-25.31 0c-4.23,0 -7.65,-3.43 -7.65,-7.66 0,-4.23 3.43,-7.66 7.65,-7.66l25.31 0c-1.81,-19.07 -10.3,-36.2 -23.1,-49 -12.81,-12.81 -29.93,-21.3 -49,-23.1l0 25.31c0,4.23 -3.43,7.65 -7.66,7.65 -4.23,0 -7.66,-3.43 -7.66,-7.65l0 -25.31c-19.07,1.81 -36.2,10.3 -49,23.1 -12.81,12.81 -21.3,29.93 -23.1,49l25.31 0c4.23,0 7.65,3.43 7.65,7.66 0,4.23 -3.43,7.66 -7.65,7.66l-25.31 0c1.81,19.07 10.3,36.2 23.1,49 12.81,12.81 29.93,21.3 49,23.1l0 -25.31c0,-4.23 3.43,-7.65 7.66,-7.65 4.23,0 7.66,3.43 7.66,7.65l0 25.31c19.07,-1.81 36.2,-10.3 49,-23.1 12.81,-12.81 21.3,-29.93 23.1,-49zm15.37 -15.31l30.53 0c-1.91,-31.72 -15.55,-60.27 -36.64,-81.37 -21.1,-21.09 -49.65,-34.74 -81.37,-36.64l0 30.53c23.3,1.85 44.25,12.07 59.83,27.65 15.58,15.58 25.8,36.53 27.65,59.83zm-102.8 -87.48l0 -30.53c-31.72,1.91 -60.27,15.55 -81.37,36.64 -21.09,21.1 -34.74,49.65 -36.64,81.37l30.53 0c1.85,-23.3 12.07,-44.25 27.65,-59.83 15.58,-15.58 36.53,-25.8 59.83,-27.65zm-87.48 102.8l-30.53 0c1.91,31.72 15.55,60.27 36.64,81.37 21.1,21.09 49.65,34.74 81.37,36.64l0 -30.53c-23.3,-1.85 -44.25,-12.07 -59.83,-27.65 -15.58,-15.58 -25.8,-36.53 -27.65,-59.83zm-45.86 0l-14.68 0c-4.23,0 -7.66,-3.43 -7.66,-7.66 0,-4.23 3.43,-7.66 7.66,-7.66l14.68 0c1.92,-35.94 17.28,-68.32 41.15,-92.19 23.87,-23.87 56.25,-39.23 92.19,-41.15l0 -14.68c0,-4.23 3.43,-7.66 7.66,-7.66 4.23,0 7.66,3.43 7.66,7.66l0 14.68c35.94,1.92 68.32,17.28 92.19,41.15 23.87,23.87 39.23,56.25 41.15,92.19l14.68 0c4.23,0 7.66,3.43 7.66,7.66 0,4.23 -3.43,7.66 -7.66,7.66l-14.68 0c-1.92,35.94 -17.28,68.32 -41.15,92.19 -23.87,23.87 -56.24,39.23 -92.19,41.15l0 14.68c0,4.23 -3.43,7.66 -7.66,7.66 -4.23,0 -7.66,-3.43 -7.66,-7.66l0 -14.68c-35.94,-1.92 -68.32,-17.28 -92.19,-41.15 -23.87,-23.87 -39.23,-56.25 -41.15,-92.19z"/>
    </g></svg>
  ),
  satellite: () => (
    <svg data-icon viewBox="0 0 24 24" fill="currentColor"><g transform="scale(0.218182) translate(5,10)">
      <path d="M73.594 51.875c-0.742-0.73-1.75-1.133-2.789-1.117-1.043 0.016-2.035 0.445-2.758 1.195l-4.766 5-2.5-2.5 9.922-10.312c1.594-1.676 1.727-4.262 0.312-6.094l4.922-5.312c1.168-1.235 1.137-3.18-0.078-4.375l-4.062-4.141c-1.215-1.191-3.16-1.191-4.375 0l-5.078 5-0.547-0.547c-1.801-1.809-4.719-1.844-6.562-0.078l-9.141 8.828-2.734-2.734 3.984-3.906c0.754-0.746 1.172-1.77 1.156-2.828-0.016-1.063-0.461-2.07-1.234-2.797l-25.391-24.062c-1.539-1.469-3.973-1.434-5.469 0.078l-10.625 11.016c-0.719 0.754-1.106 1.766-1.078 2.805 0.031 1.043 0.473 2.031 1.234 2.742l25.547 23.438c1.531 1.418 3.902 1.383 5.391-0.078l4.219-4.141 2.734 2.734-9.453 8.984-0.937-0.234c-7.656-1.875-15.234-0.391-22.578 4.453-0.789 0.52-1.301 1.367-1.395 2.309-0.09 0.941 0.25 1.875 0.926 2.535l15 14.922-3.672 3.672c-2.023-1.066-4.52-0.516-5.906 1.301-1.391 1.816-1.266 4.367 0.293 6.043 1.555 1.672 4.094 1.977 6.004 0.723 1.91-1.258 2.637-3.707 1.719-5.801l3.75-3.672 14.766 14.766c0.578 0.59 1.363 0.926 2.188 0.938h0.312c0.926-0.106 1.758-0.621 2.266-1.406 2.266-3.438 7.266-12.578 4.297-23.281l-0.391-1.328 0.312-0.234 7.266-7.656 2.5 2.5-2.969 3.125c-0.719 0.754-1.106 1.766-1.078 2.805 0.031 1.043 0.473 2.031 1.234 2.742l25.469 23.984c0.754 0.719 1.766 1.106 2.805 1.078 1.043-0.031 2.031-0.473 2.742-1.234l9.688-10.234c0.719-0.754 1.106-1.766 1.078-2.805-0.031-1.043-0.473-2.031-1.234-2.742z"/>
      <path d="M9.609 74.219c-0.414-0.043-0.828 0.082-1.152 0.344-0.324 0.266-0.527 0.648-0.566 1.062 0 0.312-0.625 6.953 3.828 11.953 2.969 3.359 7.422 5.156 13.203 5.312h0.078c0.863 0 1.562-0.699 1.562-1.562s-0.699-1.562-1.562-1.562c-4.844-0.156-8.594-1.562-10.938-4.219-3.516-3.984-3.125-9.531-3.125-9.609 0.094-0.836-0.496-1.598-1.328-1.719z"/>
      <path d="M26.484 96.797c-7.109 0.391-12.734-1.406-16.719-5.234-6.562-6.328-6.641-16.406-6.641-16.562 0-0.414-0.164-0.812-0.457-1.105s-0.691-0.457-1.105-0.457c-0.863 0-1.562 0.699-1.562 1.562 0 0.469 0 11.484 7.578 18.828 4.297 4.141 10.078 6.172 17.188 6.172h1.875c0.863-0.043 1.527-0.777 1.484-1.641s-0.777-1.527-1.641-1.484z"/>
      <path d="M25.625 12.344c-0.609-0.594-1.578-0.594-2.188 0l-7.031 7.031c-0.363 0.273-0.59 0.688-0.621 1.141-0.031 0.449 0.133 0.895 0.453 1.215 0.32 0.32 0.766 0.484 1.215 0.453 0.453-0.031 0.867-0.258 1.141-0.621l7.031-7.031c0.594-0.609 0.594-1.578 0-2.188z"/>
      <path d="M32.891 20.781l-6.953 6.953c-0.301 0.289-0.473 0.688-0.48 1.106-0.008 0.418 0.152 0.82 0.441 1.121 0.606 0.625 1.602 0.645 2.227 0.039l6.953-6.953c0.465-0.621 0.406-1.492-0.145-2.043-0.551-0.551-1.422-0.609-2.043-0.145z"/>
      <path d="M78.75 63.125c-0.609-0.594-1.578-0.594-2.188 0l-7.031 7.031c-0.363 0.273-0.59 0.688-0.621 1.141-0.031 0.449 0.133 0.895 0.453 1.215 0.32 0.32 0.766 0.484 1.215 0.453 0.453-0.031 0.867-0.258 1.141-0.621l7.031-7.031c0.594-0.609 0.594-1.578 0-2.188z"/>
      <path d="M86.016 71.562l-6.953 6.953c-0.363 0.273-0.59 0.688-0.621 1.141-0.031 0.449 0.133 0.895 0.453 1.215 0.32 0.32 0.766 0.484 1.215 0.453 0.453-0.031 0.867-0.258 1.141-0.621l6.953-6.953c0.465-0.621 0.406-1.492-0.145-2.043-0.551-0.551-1.422-0.609-2.043-0.145z"/>
    </g></svg>
  ),
  ring: () => (
    <svg data-icon viewBox="0 0 24 24" fill="currentColor"><g transform="scale(0.218182) translate(5,10)">
      <path d="m50 85.391c17.43 0 31.621-14.18 31.621-31.621 0-14.488-9.8086-26.73-23.141-30.449l2.2188-8.7109h-21.398l2.2188 8.7109c-13.328 3.7109-23.141 15.949-23.141 30.449 0 17.441 14.191 31.621 31.621 31.621zm0-59.242c15.23 0 27.621 12.391 27.621 27.621s-12.391 27.621-27.621 27.621-27.621-12.391-27.621-27.621 12.391-27.621 27.621-27.621z"/>
    </g></svg>
  ),
  bracelet: () => (
    <svg data-icon viewBox="0 0 24 24" fill="currentColor"><g transform="scale(0.258065) translate(-4,-29)">
      <path d="M93.75 50.484l-1.059 0.867c-0.477 0.36-0.984 0.711-1.535 1.047-7.715 4.785-23.25 8.129-41.156 8.129s-33.441-3.344-41.156-8.129c-0.551-0.336-1.059-0.688-1.535-1.047l-1.059-0.867v5.18c0 1.215 0.684 2.352 1.82 3.445 1.387 1.336 3.426 2.57 5.969 3.684 8.113 3.555 21.207 5.836 35.961 5.836 14.758 0 27.852-2.281 35.961-5.836 2.543-1.117 4.582-2.348 5.969-3.684 1.133-1.094 1.82-2.227 1.82-3.445zm-35.648-18.887v8.098c14.82 0.852 27.203 4.039 33.625 8.262 0.07-0.063 0.137-0.125 0.203-0.191 1.133-1.094 1.82-2.227 1.82-3.441 0-1.09-0.559-2.117-1.492-3.113-1.148-1.223-2.836-2.352-4.961-3.398-6.535-3.215-17-5.504-29.191-6.219zm-16.207 0c-12.191 0.715-22.656 3.004-29.191 6.219-2.125 1.047-3.812 2.176-4.961 3.398-0.934 0.992-1.492 2.023-1.492 3.113 0 1.215 0.684 2.348 1.82 3.441 0.066 0.066 0.133 0.129 0.203 0.191 6.422-4.223 18.805-7.41 33.625-8.262v-8.098z" fillRule="evenodd"/>
    </g></svg>
  ),
  camera: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  ),
  restart: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
    </svg>
  ),
  gear: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  link: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
    </svg>
  ),
  copy: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  ),
  home: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  ),
  handshake: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 17l-2 2-4-4 4.5-4.5"/>
      <path d="M13 7l2-2 4 4-4.5 4.5"/>
      <path d="M3 13l4 4"/>
      <path d="M17 7l4 4"/>
      <path d="M12 12l-2-2"/>
    </svg>
  ),
  people: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/>
      <path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  dots: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
    </svg>
  ),
  play: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  ),
  dollarSign: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
    </svg>
  ),
  zap: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  cards: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="12" height="16" rx="1.5" transform="rotate(-8 8 12)"/>
      <rect x="10" y="4" width="12" height="16" rx="1.5" transform="rotate(8 16 12)"/>
    </svg>
  ),
  bell: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  ),
  check: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  mapPin: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  /* Calendar with a check mark — "jump to today" affordance. */
  calendarCheck: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8"  y1="2" x2="8"  y2="6"/>
      <line x1="3"  y1="9" x2="21" y2="9"/>
      <polyline points="8.5 15 11 17.5 15.5 13"/>
    </svg>
  ),
  /* Grid of dots — date-picker affordance (a dot per date in a
     calendar grid). 4 rows x 4 cols. */
  pointer: () => (
    <svg data-icon viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5"  cy="5"  r="1.4"/>
      <circle cx="11" cy="5"  r="1.4"/>
      <circle cx="17" cy="5"  r="1.4"/>
      <circle cx="5"  cy="11" r="1.4"/>
      <circle cx="11" cy="11" r="1.4"/>
      <circle cx="17" cy="11" r="1.4"/>
      <circle cx="5"  cy="17" r="1.4"/>
      <circle cx="11" cy="17" r="1.4"/>
      <circle cx="17" cy="17" r="1.4"/>
    </svg>
  ),
  plane: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
    </svg>
  ),
  umbrella: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 12a11 11 0 0 0-22 0"/>
      <path d="M12 12v6a2 2 0 0 0 4 0"/>
    </svg>
  ),
  palmTree: () => (
    <svg data-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4"/>
      <path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3"/>
      <path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35z"/>
      <path d="M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-10-2-10z"/>
    </svg>
  ),
};

export default Icon;
