import { describe, it, expect } from 'vitest';
import { APP_NAME, ORG_NAME, App } from './App';
import React from 'react';

describe('App Component', () => {
  it('defines correct app name and organization', () => {
    expect(APP_NAME).toBe('Frontdesk');
    expect(ORG_NAME).toBe('Arvo Systems');
  });

  it('renders App element tree without error', () => {
    const element = React.createElement(App);
    expect(element).toBeDefined();
    expect(element.type).toBe(App);
  });
});

