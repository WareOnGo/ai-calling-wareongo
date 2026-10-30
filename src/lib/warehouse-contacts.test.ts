import { expect, it } from 'vitest';
import { normalizeWarehousePhone, warehouseContacts } from '../../database/warehouse-contact-backfill.mjs';
import { warehouseParsingCorrections } from '../../database/repair-warehouse-contact-parsing.mjs';
import { assembleBatch } from './dispatch-plan';

it('normalizes country codes, punctuation, leading zeros, Unicode spaces and multiple phone tokens',()=>{
  expect(warehouseContacts([{id:42,contactNumber:'\u202a+91\u00a098765\u00a043210 / 09876543210; 98888-88888',alt_phone_number:'9876543210'},
    {id:43,contactNumber:'9876543210, 123',alt_phone_number:'NA'}])).toEqual([
      {phone_last10:'9876543210',warehouse_id:42,source_fields:['contactNumber','alt_phone_number']},
      {phone_last10:'9876543210',warehouse_id:43,source_fields:['contactNumber']},
      {phone_last10:'9888888888',warehouse_id:42,source_fields:['contactNumber']},
    ]);
});
it.each([
  '9876543210', '+91 98765 43210', '91 (98765) 43210', '09876543210', '0091-98765-43210',
  '\u202a+91\u00a098765\u00a043210\u202c', '＋９１ ９８７６５ ４３２１０', '98765–43210',
])('preserves recognized Indian formatting: %s', value => {
  expect(normalizeWarehousePhone(value)).toBe('9876543210');
});
it.each([
  '+91 98765 4321', '91987654321', '98765432109', '69876543210', '89765432109',
  '+1 987 654 3210', '1 (212) 555-0199', '+971 50 123 4567', '+968 9123 4567',
  '0044 9876543210', '+9876543210', '++919876543210', '98+76543210',
  '9876543210 ext 12', '9876543210.0', '9.876543210e9', 'owner 9876543210',
  '9876543210 9888888888', '987654321', '', null,
])('rejects values that would need guessed digits or an arbitrary prefix removed: %s', value => {
  expect(normalizeWarehousePhone(value)).toBeNull();
});
it('keeps multiple warehouse IDs and valid alternate numbers while excluding malformed source tokens', () => {
  const source = [
    {id:1,contactNumber:'+1 987 654 3210',alt_phone_number:'+91 98765 43210'},
    {id:2,contactNumber:'9876543210; +91 98888 8888',alt_phone_number:'0091 98765 43210'},
    {id:3,contactNumber:'+91 98765 4321',alt_phone_number:'9888888888'},
  ];
  expect(warehouseContacts(source)).toEqual([
    {phone_last10:'9876543210',warehouse_id:1,source_fields:['alt_phone_number']},
    {phone_last10:'9876543210',warehouse_id:2,source_fields:['contactNumber','alt_phone_number']},
    {phone_last10:'9888888888',warehouse_id:3,source_fields:['alt_phone_number']},
  ]);
  // The foreign primary must not remove an association supported by a valid alternate.
  expect(warehouseParsingCorrections(source).map(({phone_last10,warehouse_id})=>({phone_last10,warehouse_id}))).toEqual([
    {phone_last10:'1987654321',warehouse_id:3},
    {phone_last10:'1988888888',warehouse_id:2},
  ]);
});
it('cannot re-include registered warehouse numbers by changing previous-call exclusions or language',()=>{
  const row={id:'one',name:'Owner',contact:'9876543210',area:'',state:'Delhi',cat:'available' as const,queued:false,warehouseIds:[42]};
  const fresh={...row,id:'two',contact:'9888888888',cat:'' as const,warehouseIds:[]};
  for(const mode of ['auto','hindi','english'] as const){
    const result=assembleBatch([row,fresh],[],{mode,availableLanguages:['hindi','english']});
    expect(result.warehouseExists).toBe(1);expect(result.callable.map(r=>r.id)).toEqual(['two']);
  }
});
