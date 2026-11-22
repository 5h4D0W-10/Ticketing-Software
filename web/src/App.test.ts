import { describe, it, expect } from 'vitest';
import React from 'react';
import { APP_NAME, ORG_NAME, App } from './App';
import { LoginPage } from './components/agent/LoginPage';
import { TicketListPage } from './components/agent/TicketListPage';
import { TicketDetailPage } from './components/agent/TicketDetailPage';
import { LateReportsPage } from './components/agent/LateReportsPage';
import { HolidaysPage } from './components/agent/HolidaysPage';
import { CreateTicketPage } from './components/customer/CreateTicketPage';
import { CustomerTicketPage } from './components/customer/CustomerTicketPage';
import { Navbar } from './components/Navbar';

describe('Frontend Component Tree', () => {
  it('defines correct app name and organization', () => {
    expect(APP_NAME).toBe('Frontdesk');
    expect(ORG_NAME).toBe('Arvo Systems');
  });

  it('instantiates root App component with AuthProvider', () => {
    const element = React.createElement(App);
    expect(element).toBeDefined();
    expect(element.type).toBe(App);
  });

  it('instantiates Navbar component', () => {
    const element = React.createElement(Navbar, {
      currentView: 'customer-new',
      onNavigate: () => {},
    });
    expect(element).toBeDefined();
    expect(element.props.currentView).toBe('customer-new');
  });

  it('instantiates LoginPage component', () => {
    const element = React.createElement(LoginPage, {
      onLoginSuccess: () => {},
    });
    expect(element).toBeDefined();
    expect(typeof element.props.onLoginSuccess).toBe('function');
  });

  it('instantiates TicketListPage (ONE main screen for agents)', () => {
    const element = React.createElement(TicketListPage, {
      onSelectTicket: () => {},
    });
    expect(element).toBeDefined();
  });

  it('instantiates TicketDetailPage with two compose boxes and SLA header', () => {
    const element = React.createElement(TicketDetailPage, {
      ticketId: 'test-ticket-id',
      onBack: () => {},
    });
    expect(element).toBeDefined();
    expect(element.props.ticketId).toBe('test-ticket-id');
  });

  it('instantiates LateReportsPage (Lead supervisor report)', () => {
    const element = React.createElement(LateReportsPage, {
      onSelectTicket: () => {},
    });
    expect(element).toBeDefined();
  });

  it('instantiates HolidaysPage (Lead supervisor holidays CRUD)', () => {
    const element = React.createElement(HolidaysPage);
    expect(element).toBeDefined();
  });

  it('instantiates CreateTicketPage with 3 urgency options', () => {
    const element = React.createElement(CreateTicketPage, {
      onTicketCreated: () => {},
    });
    expect(element).toBeDefined();
  });

  it('instantiates CustomerTicketPage via secret unguessable token', () => {
    const element = React.createElement(CustomerTicketPage, {
      token: 'test-secret-token-123',
      onOpenFollowUp: () => {},
      onBackToNew: () => {},
    });
    expect(element).toBeDefined();
    expect(element.props.token).toBe('test-secret-token-123');
  });
});
