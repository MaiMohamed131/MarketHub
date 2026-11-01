import { configureStore, createSlice } from '@reduxjs/toolkit';
const ui=createSlice({name:'ui',initialState:{menuOpen:false},reducers:{toggleMenu(s){s.menuOpen=!s.menuOpen},closeMenu(s){s.menuOpen=false}}});
export const {toggleMenu,closeMenu}=ui.actions;
export const store=configureStore({reducer:{ui:ui.reducer}});
export type RootState=ReturnType<typeof store.getState>;
