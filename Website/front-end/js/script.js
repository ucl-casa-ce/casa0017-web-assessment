$(document).ready(function() {
    // the effect of Button hover
    $('.btn-custom').hover(
      function() {
        $(this).css({
          'background-color': '#a8c9c2', 
          'border-color': '#a8c9c2', 
          'color': '#000' // text color
        });
      },
      function() {
        // Mouse exit
        $(this).css({
          'background-color': '#bdd8bdb0',
          'border-color': '#bdd8bdb0', 
          'color': '#000' // text color
        });
      }
    );
  
    // Button click effect
    $('.btn-custom').click(function() {
      $(this).css({
        'background-color': '#90a8a2', 
        'border-color': '#90a8a2', 
        'color': '#000' // text color
      });
    });
  });