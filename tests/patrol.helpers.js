'use strict';

/**
 * Test doubles for the patrol monitoring tests: in-memory repositories,
 * a mock GPS service, a fixed clock and a silent logger. They extend the
 * same abstract contracts as the real classes, so they are valid
 * substitutes (Liskov) and let every service run without MongoDB.
 */

const contracts = require('../src/repositories/patrolContracts');
const GpsTrackingService = require('../src/gps/GpsTrackingService');
const { GpsServiceUnavailableError } = require('../src/errors/patrolErrors');
const { PatrolStatus, IN_PROGRESS_STATUSES } = require('../src/constants/patrolEnums');
const { LocationPoint, Zone } = require('../src/models/patrolDomain');
const { buildSeedData } = require('../src/utils/patrolSeed');

const NOW = new Date('2026-05-18T10:00:00.000Z');
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const time = (value) => new Date(value).getTime();
const copy = (value) => structuredClone(value);
const hoursAgo = (hours, from = NOW) => new Date(from.getTime() - hours * HOUR_MS);
const minutesAgo = (minutes, from = NOW) => new Date(from.getTime() - minutes * MINUTE_MS);

class InMemoryPatrolRepository extends contracts.PatrolReader {
  constructor(patrols = []) {
    super();
    this.patrols = copy(patrols);
  }

  async findByPatrolId(patrolId) {
    const patrol = this.patrols.find((item) => item.patrolId === patrolId);
    return patrol ? copy(patrol) : null;
  }

  async findInProgress() {
    const inProgress = this.patrols.filter((item) => IN_PROGRESS_STATUSES.includes(item.status));
    return copy(inProgress.sort((a, b) => time(a.startTime) - time(b.startTime)));
  }

  async findCompleted() {
    const completed = this.patrols.filter((item) => item.status === PatrolStatus.COMPLETED);
    return copy(completed.sort((a, b) => time(b.endTime) - time(a.endTime)));
  }

  async findCompletedSince(since) {
    const completed = await this.findCompleted();
    return completed.filter((item) => time(item.endTime) >= since.getTime());
  }

  async findByCriteria(criteria) {
    const matches = this.patrols.filter(
      (item) =>
        (!criteria.rangerId || item.rangerIds.includes(criteria.rangerId)) &&
        (!criteria.routeId || item.routeId === criteria.routeId) &&
        (!criteria.status || item.status === criteria.status) &&
        (!criteria.from || time(item.startTime) >= criteria.from.getTime()) &&
        (!criteria.to || time(item.startTime) <= criteria.to.getTime()),
    );
    return copy(matches.sort((a, b) => time(b.startTime) - time(a.startTime)));
  }

  async saveEvaluation(patrolId, evaluation) {
    const patrol = this.patrols.find((item) => item.patrolId === patrolId);
    patrol.evaluation = copy(evaluation);
    return copy(patrol.evaluation);
  }

  async appendTrackPoint(patrolId, point) {
    this.patrols.find((item) => item.patrolId === patrolId).track.push(copy(point));
  }
}

class InMemoryRangerRepository extends contracts.RangerReader {
  constructor(rangers = []) {
    super();
    this.rangers = copy(rangers);
  }

  async findAll() {
    return copy(this.rangers);
  }

  async findByRangerId(rangerId) {
    const ranger = this.rangers.find((item) => item.rangerId === rangerId);
    return ranger ? copy(ranger) : null;
  }

  async findByRangerIds(rangerIds) {
    return copy(this.rangers.filter((item) => rangerIds.includes(item.rangerId)));
  }

  async updateTracking(rangerId, changes) {
    Object.assign(
      this.rangers.find((item) => item.rangerId === rangerId),
      copy(changes),
    );
  }
}

class InMemoryParkRepository extends contracts.ParkReader {
  constructor(parks) {
    super();
    this.parks = parks;
  }

  async findByParkId(parkId) {
    const park = this.parks.find((item) => item.parkId === parkId);
    if (!park) return null;
    return { parkId, name: park.name, location: park.location, terrainType: park.terrainType };
  }
}

class InMemoryZoneRepository extends contracts.ZoneReader {
  constructor(parks) {
    super();
    this.parks = parks;
  }

  async findAll() {
    return this.parks.flatMap((park) =>
      park.zones.map((zone) => new Zone({ ...zone, parkId: park.parkId })),
    );
  }

  async findByParkId(parkId) {
    return (await this.findAll()).filter((zone) => zone.parkId === parkId);
  }
}

class InMemoryRouteRepository extends contracts.RouteReader {
  constructor(parks) {
    super();
    this.parks = parks;
  }

  async findAll() {
    return this.parks.flatMap((park) =>
      park.routes.map((route) => ({ ...copy(route), parkId: park.parkId })),
    );
  }

  async findByParkId(parkId) {
    return (await this.findAll()).filter((route) => route.parkId === parkId);
  }

  async findByRouteId(routeId) {
    return (await this.findAll()).find((route) => route.routeId === routeId) ?? null;
  }

  async createRoute(parkId, route) {
    this.parks.find((park) => park.parkId === parkId).routes.push(copy(route));
  }

  async updateRoute(routeId, route) {
    for (const park of this.parks) {
      const index = park.routes.findIndex((item) => item.routeId === routeId);
      if (index >= 0) park.routes[index] = copy(route);
    }
  }

  async deleteRoute(routeId) {
    for (const park of this.parks) {
      park.routes = park.routes.filter((item) => item.routeId !== routeId);
    }
  }
}

/**
 * Mock GPS Tracking Service. `fixes` maps rangerId → LocationPoint | null;
 * `down: true` makes every call fail like an unreachable service.
 */
class MockGpsTrackingService extends GpsTrackingService {
  constructor({ fixes = {}, down = false, failWith = null } = {}) {
    super();
    this.fixes = fixes;
    this.down = down;
    this.failWith = failWith;
    this.calls = [];
  }

  async getCurrentLocation(rangerId) {
    this.calls.push(rangerId);
    if (this.failWith) throw this.failWith;
    if (this.down) throw new GpsServiceUnavailableError();
    return LocationPoint.from(this.fixes[rangerId] ?? null);
  }
}

/** A logger that records what was logged instead of printing it. */
function createSilentLogger() {
  const entries = [];
  const record = (level) => (message, details) => entries.push({ level, message, details });
  return { entries, info: record('info'), warn: record('warn'), error: record('error') };
}

/** In-memory repositories loaded with the Yala sample data. */
function createRepositories({ now = NOW, includeActive = true, patrols, rangers } = {}) {
  const seed = buildSeedData({ now, includeActive });
  const parks = [copy(seed.park)];

  return {
    seed,
    patrols: new InMemoryPatrolRepository(patrols ?? seed.patrols),
    rangers: new InMemoryRangerRepository(rangers ?? seed.rangers),
    parks: new InMemoryParkRepository(parks),
    zones: new InMemoryZoneRepository(parks),
    routes: new InMemoryRouteRepository(parks),
  };
}

/** A GPS fix at a route waypoint, taken "now" unless a timestamp is given. */
function fixAt(route, waypointIndex, timestamp = NOW) {
  return new LocationPoint({ ...route.waypoints[waypointIndex], timestamp });
}

module.exports = {
  NOW,
  hoursAgo,
  minutesAgo,
  fixAt,
  createRepositories,
  createSilentLogger,
  MockGpsTrackingService,
  InMemoryPatrolRepository,
  InMemoryRangerRepository,
};
