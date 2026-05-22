// Auth / RBAC constants. Extracted from src/ShippingSLAApp.jsx during PR R1.
// ROLES uses lucide-react icon components, which are imported here so they
// survive the move with the data they belong to.

import { Shield, UserCog, Eye } from 'lucide-react';

export const ROLES = {
  admin: {
    label: 'Admin',
    color: '#E74C6F',
    icon: Shield,
    description: 'Full access · edit SLAs · manage users',
    pages: ['exec','ai','split','timeline','geo','rootcause','costs','customers','sku','shift','inbound','storage','labor','waves','optimizer','forecasts','flightboard','economics','datahub','events','admin','adminportal','snowflake'],
    canEditSLA: true,
    canUploadData: true,
    canResetData: true,
    canContactCustomer: true,
  },
  manager: {
    label: 'Manager',
    color: '#f5a623',
    icon: UserCog,
    description: 'Operations view · contact customers · read-only SLAs',
    pages: ['exec','ai','split','timeline','geo','rootcause','costs','customers','sku','shift','inbound','storage','labor','waves','optimizer','forecasts','flightboard','economics','datahub','events'],
    canEditSLA: false,
    canUploadData: true,
    canResetData: false,
    canContactCustomer: true,
  },
  viewer: {
    label: 'Viewer',
    color: '#1ABC9C',
    icon: Eye,
    description: 'Read-only · dashboards only · no actions',
    pages: ['exec','timeline','geo','rootcause','inbound','storage','waves','flightboard'],
    canEditSLA: false,
    canUploadData: false,
    canResetData: false,
    canContactCustomer: false,
  },
};

export const MOCK_USERS = [
  { username: 'admin', password: 'admin123', role: 'admin', displayName: 'GMC', email: 'gmc@kissusa.com', entraId: 'gmc@kissusa.onmicrosoft.com', entraObjId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', department: 'IT Operations', authMethod: 'entra' },
  { username: 'manager', password: 'manager123', role: 'manager', displayName: 'Mike Ops', email: 'mike.ops@kissusa.com', entraId: 'mike.ops@kissusa.onmicrosoft.com', entraObjId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', department: 'DC Operations', authMethod: 'entra' },
  { username: 'viewer', password: 'viewer123', role: 'viewer', displayName: 'Sam Viewer', email: 'sam.viewer@kissusa.com', entraId: 'sam.viewer@kissusa.onmicrosoft.com', entraObjId: 'c3d4e5f6-a7b8-9012-cdef-123456789012', department: 'Customer Service', authMethod: 'entra' },
];

// Default SLA targets (minutes) — editable by admin
export const DEFAULT_SLAS = [
  { id: 1, key: 'stage1', name: 'Order → Confirm',          system: 'SAP',       target: 30,  min: 10, max: 120,  description: 'Sales order create to order confirm' },
  { id: 2, key: 'stage2', name: 'Confirm → Delivery Post',  system: 'SAP',       target: 120, min: 30, max: 480,  description: 'Order confirm to delivery doc posted' },
  { id: 3, key: 'stage3', name: 'SAP → SCALE Handoff',      system: 'Interface', target: 30,  min: 5,  max: 120,  description: 'Delivery posted to SCALE received' },
  { id: 4, key: 'stage4', name: 'Wave / Allocation',        system: 'SCALE',     target: 240, min: 60, max: 720,  description: 'SCALE received to wave released' },
  { id: 5, key: 'stage5', name: 'Pick',                     system: 'SCALE',     target: 120, min: 30, max: 480,  description: 'Wave release to pick complete' },
  { id: 6, key: 'stage6', name: 'Pack',                     system: 'SCALE',     target: 60,  min: 15, max: 240,  description: 'Pick complete to pack complete' },
  { id: 7, key: 'stage7', name: 'Dock / Ship Confirm',      system: 'SCALE',     target: 120, min: 30, max: 360,  description: 'Pack complete to ship confirm' },
  { id: 8, key: 'stage8', name: 'Carrier Pickup',           system: 'UPS/LTL',   target: 480, min: 60, max: 1440, description: 'Ship confirm to carrier scan' },
];

export const DEFAULT_KPI_TARGETS = {
  onTimeShipPct: 95,
  onTimeDelivPct: 92,
  orderToDockHrs: 18,
  splitRatePct: 0,
  damageRatePct: 1.5,
};

export const ALL_PAGES = [
  { category: 'Executive', pages: [
    { id: 'exec', label: 'Overview' },
    { id: 'ai', label: 'AI Risk & Alerts' },
    { id: 'costs', label: '$ at Risk' },
    { id: 'economics', label: 'Economics' },
    { id: 'customers', label: 'Customer Impact' },
  ]},
  { category: 'Shipping', pages: [
    { id: 'timeline', label: 'SLA Timeline' },
    { id: 'split', label: 'Split Shipments' },
    { id: 'flightboard', label: 'Flight Board' },
    { id: 'rootcause', label: 'Root Cause' },
    { id: 'geo', label: 'Geographic' },
    { id: 'sku', label: 'SKU Problems' },
    { id: 'waves', label: 'Wave Management' },
  ]},
  { category: 'Inventory', pages: [{ id: 'storage', label: 'Storage & Zones' }] },
  { category: 'Receiving', pages: [{ id: 'inbound', label: 'Inbound Ops' }] },
  { category: 'Labor', pages: [
    { id: 'labor', label: 'Workforce' },
    { id: 'shift', label: 'Shift Heatmap' },
  ]},
  { category: 'Analytics', pages: [
    { id: 'forecasts', label: 'Forecasts' },
    { id: 'optimizer', label: 'Optimizer' },
  ]},
  { category: 'Data', pages: [{ id: 'datahub', label: 'Data Hub' }] },
  { category: 'Planning', pages: [{ id: 'events', label: 'Event Calendar' }] },
  { category: 'Admin', pages: [
    { id: 'admin', label: 'SLA Config' },
    { id: 'adminportal', label: 'Access Control' },
  ]},
];

export const ALL_PAGE_COUNT = ALL_PAGES.reduce((s, g) => s + g.pages.length, 0);

export const FEATURE_PERMISSIONS = [
  { key: 'canEditSLA', label: 'Edit SLA Targets' },
  { key: 'canUploadData', label: 'Upload CSV Data' },
  { key: 'canResetData', label: 'Reset to Mock Data' },
  { key: 'canContactCustomer', label: 'Contact Customers' },
];
