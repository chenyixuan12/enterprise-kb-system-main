<template>
    <div class="page-header">
        <h1 class="page-title">{{ props.title }}</h1>
        <div class="actions">
            <slot name="buttons"></slot>
        </div>
    </div>
</template>

<script setup>
const props = defineProps({
    title:{
        type:String,
        default:'页面标题'
    }
})
</script>

<style lang="scss" scoped>
.page-header{
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 20px;
    .page-title{
        font-size: 24px;
        font-weight: bold;
        color: #1a1a1a;
        margin: 0;
    }
}
</style>