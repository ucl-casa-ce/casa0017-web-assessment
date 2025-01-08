// 获取所有的爱心按钮
document.querySelectorAll('.favorite-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      this.classList.toggle('active'); // 切换激活状态
    });
  });