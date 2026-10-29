import { expect, it } from 'vitest';
import { warehouseContacts } from '../../database/warehouse-contact-backfill.mjs';
import { assembleBatch } from './dispatch-plan';

it('normalizes country codes, punctuation, leading zeros, Unicode spaces and multiple phone tokens',()=>{
  expect(warehouseContacts([{id:42,contactNumber:'\u202a+91\u00a098765\u00a043210 / 09876543210; 98888-88888',alt_phone_number:'9876543210'},
    {id:43,contactNumber:'9876543210, 123',alt_phone_number:'NA'}])).toEqual([
      {phone_last10:'9876543210',warehouse_id:42,source_fields:['contactNumber','alt_phone_number']},
      {phone_last10:'9876543210',warehouse_id:43,source_fields:['contactNumber']},
      {phone_last10:'9888888888',warehouse_id:42,source_fields:['contactNumber']},
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
