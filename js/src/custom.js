��/ * u�b�}�eQ�[bT�R�^Y6R	c��* /  
 ! f u n c t i o n   ( e ,   t ,   a )   {    
     / *   c o d e   * /  
     v a r   i n i t C o p y C o d e   =   f u n c t i o n ( ) {  
         v a r   c o p y H t m l   =   ' ' ;  
         c o p y H t m l   + =   ' < b u t t o n   c l a s s = " b t n - c o p y "   d a t a - c l i p b o a r d - s n i p p e t = " " > ' ;  
         c o p y H t m l   + =   '     < i   c l a s s = " f a   f a - g l o b e " > < / i > < s p a n > c o p y < / s p a n > ' ;  
         c o p y H t m l   + =   ' < / b u t t o n > ' ;  
         $ ( " . h i g h l i g h t   . c o d e   p r e " ) . b e f o r e ( c o p y H t m l ) ;  
         n e w   C l i p b o a r d J S ( ' . b t n - c o p y ' ,   {  
                 t a r g e t :   f u n c t i o n ( t r i g g e r )   {  
                         r e t u r n   t r i g g e r . n e x t E l e m e n t S i b l i n g ;  
                 }  
         } ) ;  
     }  
     i n i t C o p y C o d e ( ) ;  
 } ( w i n d o w ,   d o c u m e n t ) ; 