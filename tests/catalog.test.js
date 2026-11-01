import { test, expect, jest, afterEach } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../dist/app.js';
import { catalogQuery, buildFilter } from '../dist/catalog.js';
import { Product, Category } from '../dist/catalog-models.js';
afterEach(()=>{mongoose.connection._readyState=0;jest.restoreAllMocks();});
test('invalid filters rejected before connecting',async()=>{for(const q of ['page=0','page=1.5','limit=1000','sort=unsafe','minPrice=-1','maxPrice=NaN','minPrice=20&maxPrice=10','category=bad','q[$ne]=x','minPrice=0.001','q='+ 'a'.repeat(101)])expect((await request(app).get('/api/products?'+q)).status).toBe(400);});
test('invalid detail ID rejected',async()=>expect((await request(app).get('/api/products/not-an-id')).status).toBe(400));
test('database outage returns a useful unavailable response',async()=>{expect((await request(app).get('/api/categories')).status).toBe(503);expect((await request(app).get('/api/products')).status).toBe(503);});
test('currency filters use integer cents and search escapes regex metacharacters',()=>{const q=catalogQuery.parse({q:'.*',minPrice:'12.34',maxPrice:'20'});const f=buildFilter(q,[]);expect(f.price).toEqual({$gte:1234,$lte:2000});expect(f.$or[0].name.$regex).toBe('\\.\\*');expect(f.active).toBe(true);});
test('products enforce integer money and nonnegative inventory',()=>{const p=new Product({name:'Test',description:'Test',price:1.2,stock:-1,category:new mongoose.Types.ObjectId(),seller:new mongoose.Types.ObjectId(),storeName:'Test'});const e=p.validateSync();expect(e.errors.price).toBeDefined();expect(e.errors.stock).toBeDefined();});
function chain(value){const c={};for(const k of ['select','sort','skip','limit','maxTimeMS'])c[k]=jest.fn(()=>c);c.lean=jest.fn(async()=>value);return c;}
test('listing combines visibility constraints, sorting and pagination',async()=>{mongoose.connection._readyState=1;const category=new mongoose.Types.ObjectId();jest.spyOn(Category,'find').mockReturnValue(chain([{_id:category}]));const c=chain([{_id:'example',name:'A find',price:1234}]);jest.spyOn(Product,'find').mockReturnValue(c);jest.spyOn(Product,'countDocuments').mockReturnValue({maxTimeMS:async()=>25});const r=await request(app).get('/api/products?sort=price-asc&page=2&limit=12');expect(r.status).toBe(200);expect(r.body.pagination).toEqual({page:2,limit:12,total:25,pages:3});expect(c.skip).toHaveBeenCalledWith(12);expect(c.sort).toHaveBeenCalledWith({price:1,_id:1});expect(Product.find.mock.calls[0][0].active).toBe(true);});
test('inactive or absent product is not exposed',async()=>{mongoose.connection._readyState=1;jest.spyOn(Product,'findOne').mockReturnValue(chain(null));expect((await request(app).get('/api/products/'+new mongoose.Types.ObjectId())).status).toBe(404);});
test('detail only returns active category and excludes itself from related products',async()=>{mongoose.connection._readyState=1;const id=new mongoose.Types.ObjectId(),category=new mongoose.Types.ObjectId();jest.spyOn(Product,'findOne').mockReturnValue(chain({_id:id,category,name:'A find',price:1200}));jest.spyOn(Category,'findOne').mockReturnValue(chain({_id:category,name:'Home'}));jest.spyOn(Product,'find').mockReturnValue(chain([]));const r=await request(app).get('/api/products/'+id);expect(r.status).toBe(200);expect(r.body.product.category.name).toBe('Home');expect(Product.find.mock.calls[0][0]._id.$ne).toEqual(id);});


test('marketplace filters combine brand, availability, rating and real discount comparison',()=>{
 const query=catalogQuery.parse({brand:'Anker',minRating:'4',inStock:'true',deals:'true'});
 const filter=buildFilter(query,[]);
 expect(filter.brand).toBe('Anker');expect(filter.stock).toEqual({$gt:0});expect(filter.averageRating).toEqual({$gte:4});expect(filter.$expr).toEqual({$gt:['$originalPrice','$price']});
 expect(buildFilter(catalogQuery.parse({inStock:'false'}),[]).stock).toBe(0);
});
test('marketplace filters reject malformed or out of bounds values',()=>{
 for(const q of [{minRating:'6'},{minRating:'no'},{inStock:'yes'},{deals:'yes'},{brand:'a'.repeat(81)}])expect(catalogQuery.safeParse(q).success).toBe(false);
 expect(catalogQuery.parse({sort:'rating'}).sort).toBe('rating');
});
