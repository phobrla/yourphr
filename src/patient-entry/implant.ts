import type { Device } from '@medplum/fhirtypes';
import type { BuiltRecord, PatientEntryContext, PatientEntryRequest } from './shared.js';
import { PatientEntryError, stamp, statedName } from './shared.js';

const US_CORE_IMPLANTABLE_DEVICE = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-implantable-device';
const DEVICE_STATUSES = new Set(['active', 'inactive', 'unknown']);

export function buildPatientImplant(req: PatientEntryRequest, _now = new Date(), context: PatientEntryContext = { subject: '' }): BuiltRecord {
  const type = statedName(req);
  if (!type) throw new PatientEntryError('Name the implant.');
  if (!context.subject) throw new PatientEntryError('A patient record is required for an implant.');

  const statedStatus = (req.implant_status ?? 'unknown').trim();
  if (!DEVICE_STATUSES.has(statedStatus)) throw new PatientEntryError('Choose a valid implant status.');

  const device: Device = {
    resourceType: 'Device',
    status: statedStatus as Device['status'],
    type: { text: type },
    patient: { reference: context.subject },
  };

  const deviceIdentifier = (req.implant_device_identifier ?? '').trim();
  if (deviceIdentifier) device.udiCarrier = [{ deviceIdentifier }];

  const distinctIdentifier = (req.implant_distinct_identifier ?? '').trim();
  if (distinctIdentifier) device.distinctIdentifier = distinctIdentifier;

  const serialNumber = (req.implant_serial_number ?? '').trim();
  if (serialNumber) device.serialNumber = serialNumber;

  const lotNumber = (req.implant_lot_number ?? '').trim();
  if (lotNumber) device.lotNumber = lotNumber;

  const manufactureDate = (req.implant_manufacture_date ?? '').trim();
  if (manufactureDate) device.manufactureDate = manufactureDate;

  const expirationDate = (req.implant_expiration_date ?? '').trim();
  if (expirationDate) device.expirationDate = expirationDate;

  stamp(device, []);
  device.meta = {
    ...device.meta,
    profile: [...(device.meta?.profile ?? []), US_CORE_IMPLANTABLE_DEVICE],
  };
  return { resource: device, sortTitle: type, review: [] };
}
